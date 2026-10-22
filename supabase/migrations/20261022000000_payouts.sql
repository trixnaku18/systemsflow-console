-- SystemsFlow v0.1 — roles, contractor payouts (M4), approvals, audit log.
-- Amounts are integer centavos (bigint). Bank account numbers never live in these
-- tables: contractor_bank.bank_ref points at a Supabase Vault secret.

-- ───────────────────────── Roles ─────────────────────────

create type public.app_role as enum ('owner', 'finance', 'closer', 'content_operator', 'team_lead', 'viewer');

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create function public.has_role(r public.app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = r);
$$;

create function public.is_payout_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('owner') or public.has_role('finance');
$$;

-- ───────────────────────── Audit log ─────────────────────────

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(new_row ->> 'id', old_row ->> 'id', new_row ->> 'contractor_id', old_row ->> 'contractor_id'),
    old_row,
    new_row
  );
  return coalesce(new, old);
end;
$$;

-- ───────────────────────── Pay bands & contractors ─────────────────────────

create type public.pay_role as enum ('it_tier_1', 'it_tier_2', 'it_tier_3', 'csm', 'tech_lead', 'tech_manager');

create table public.pay_band (
  id uuid primary key default gen_random_uuid(),
  role public.pay_role not null,
  label text not null,
  min_monthly bigint not null check (min_monthly > 0),
  max_monthly bigint not null check (max_monthly >= min_monthly),
  effective_from date not null,
  unique (role, effective_from)
);

insert into public.pay_band (role, label, min_monthly, max_monthly, effective_from) values
  ('it_tier_1', 'IT Tier 1', 1800000, 1800000, '2026-10-01'),
  ('it_tier_2', 'IT Tier 2', 2000000, 2500000, '2026-10-01'),
  ('it_tier_3', 'IT Tier 3', 2600000, 3000000, '2026-10-01'),
  ('csm', 'CSM', 3000000, 3500000, '2026-10-01'),
  ('tech_lead', 'Tech Lead', 3700000, 4000000, '2026-10-01'),
  ('tech_manager', 'Tech Manager', 4500000, 4500000, '2026-10-01');

create table public.contractor (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  -- Console login, when the contractor has one (used to stop self-entry of attendance).
  user_id uuid unique references auth.users (id) on delete set null,
  pay_role public.pay_role not null,
  monthly_fee bigint not null check (monthly_fee > 0),
  contract_type text not null default 'independent_contractor',
  contract_start date not null,
  contract_end date check (contract_end is null or contract_end >= contract_start),
  fee_change_reason text,
  band_override_reason text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contractor_bank (
  contractor_id uuid primary key references public.contractor (id) on delete cascade,
  bank_name text not null default 'UnionBank',
  account_name text not null,
  bank_ref uuid not null,          -- Vault secret id holding the account number
  fingerprint text not null,       -- HMAC of the account number, for duplicate/change checks
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Runs ─────────────────────────

create type public.run_status as enum ('draft', 'attendance_confirmed', 'review', 'approved', 'paid');

create table public.payout_run (
  id uuid primary key default gen_random_uuid(),
  period_start date not null unique,
  period_end date not null check (period_end >= period_start),
  status public.run_status not null default 'draft',
  attendance_confirmed_by uuid references auth.users (id),
  attendance_confirmed_at timestamptz,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  paid_at timestamptz,
  return_comment text,
  bank_file_path text,
  created_at timestamptz not null default now()
);

create table public.attendance (
  run_id uuid not null references public.payout_run (id) on delete cascade,
  contractor_id uuid not null references public.contractor (id),
  days_absent numeric(4, 1) not null default 0
    check (days_absent >= 0 and days_absent <= 11 and days_absent * 2 = trunc(days_absent * 2)),
  note text,
  entered_by uuid references auth.users (id) default auth.uid(),
  entered_at timestamptz not null default now(),
  primary key (run_id, contractor_id)
);

create type public.reimbursement_category as enum ('transport', 'meal', 'device', 'meds', 'other');

create table public.reimbursement (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payout_run (id) on delete cascade,
  contractor_id uuid not null references public.contractor (id),
  category public.reimbursement_category not null,
  amount bigint not null check (amount > 0),
  receipt_path text,
  description text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create type public.adjustment_kind as enum ('advance', 'deduction', 'owner_adjustment');

create table public.adjustment (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payout_run (id) on delete cascade,
  contractor_id uuid not null references public.contractor (id),
  kind public.adjustment_kind not null,
  amount bigint not null check (amount <> 0 and (kind = 'owner_adjustment' or amount > 0)),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Snapshot written when a run moves to review; frozen once approved.
create table public.payout_line (
  run_id uuid not null references public.payout_run (id) on delete cascade,
  contractor_id uuid not null references public.contractor (id),
  name text not null,
  monthly_fee bigint not null,
  base bigint not null,
  days_absent numeric(4, 1) not null,
  daily_rate bigint not null,
  absence_deduction bigint not null,
  reimbursements bigint not null,
  excluded_reimbursements bigint not null,
  advances bigint not null,
  other_deductions bigint not null,
  owner_adjustments bigint not null,
  net bigint not null,
  bank_fingerprint text,
  flags jsonb not null default '[]',
  primary key (run_id, contractor_id)
);

-- Withholding is off in v0.1 (owner decision). The switch exists so it can be turned on later.
create table public.tax_config (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default false,
  type text not null,
  effective_from date not null,
  rules jsonb not null default '{}',
  source_note text
);
insert into public.tax_config (enabled, type, effective_from, source_note)
values (false, 'EWT', '2026-10-01', 'Off by owner decision, spec v0.3');

-- ───────────────────────── Approvals (shared inbox, M5) ─────────────────────────

create table public.approval (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('content', 'proposal', 'discount', 'payout_run')),
  ref_id uuid not null,
  requested_by uuid references auth.users (id) default auth.uid(),
  approver_role public.app_role not null default 'owner',
  sla_due_at timestamptz,
  decision text check (decision in ('approved', 'returned')),
  comment text,
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Guards ─────────────────────────

-- True when the contractor row belongs to the signed-in user. Security definer so it works
-- for the Team Lead, who cannot read the contractor table directly.
create function public.is_self_contractor(p_contractor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contractor where id = p_contractor and user_id = auth.uid());
$$;


create function public.run_status_of(p_run uuid) returns public.run_status
language sql stable security definer set search_path = public as $$
  select status from public.payout_run where id = p_run;
$$;

-- Attendance, reimbursements and adjustments are editable only while the run is a draft.
create function public.guard_draft_run() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.run_status_of(coalesce(new.run_id, old.run_id)) <> 'draft' then
    raise exception 'Run is no longer a draft; return it to draft to change %', tg_table_name;
  end if;
  return coalesce(new, old);
end;
$$;

-- Lines are frozen once a run is approved.
create function public.guard_frozen_lines() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.run_status_of(coalesce(new.run_id, old.run_id)) in ('approved', 'paid') then
    raise exception 'Payout lines are frozen after approval';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger attendance_draft before insert or update or delete on public.attendance
  for each row execute function public.guard_draft_run();
create trigger reimbursement_draft before insert or update or delete on public.reimbursement
  for each row execute function public.guard_draft_run();
create trigger adjustment_draft before insert or update or delete on public.adjustment
  for each row execute function public.guard_draft_run();
create trigger payout_line_frozen before insert or update or delete on public.payout_line
  for each row execute function public.guard_frozen_lines();

create trigger audit_contractor after insert or update or delete on public.contractor
  for each row execute function public.audit();
create trigger audit_contractor_bank after insert or update or delete on public.contractor_bank
  for each row execute function public.audit();
create trigger audit_pay_band after insert or update or delete on public.pay_band
  for each row execute function public.audit();
create trigger audit_payout_run after insert or update or delete on public.payout_run
  for each row execute function public.audit();
create trigger audit_attendance after insert or update or delete on public.attendance
  for each row execute function public.audit();
create trigger audit_reimbursement after insert or update or delete on public.reimbursement
  for each row execute function public.audit();
create trigger audit_adjustment after insert or update or delete on public.adjustment
  for each row execute function public.audit();
create trigger audit_payout_line after insert or update or delete on public.payout_line
  for each row execute function public.audit();
create trigger audit_tax_config after insert or update or delete on public.tax_config
  for each row execute function public.audit();
create trigger audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function public.audit();
create trigger audit_approval after insert or update or delete on public.approval
  for each row execute function public.audit();

-- ───────────────────────── Run transitions ─────────────────────────

create function public.confirm_attendance(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.payout_run;
  missing int;
begin
  if not (public.has_role('team_lead') or public.has_role('owner')) then
    raise exception 'Only the Team Lead or Owner can confirm attendance';
  end if;
  select * into r from public.payout_run where id = p_run for update;
  if r.status <> 'draft' then raise exception 'Run is not a draft'; end if;

  select count(*) into missing
  from public.contractor c
  where c.contract_start <= r.period_end
    and (c.contract_end is null or c.contract_end >= r.period_start)
    and not exists (select 1 from public.attendance a where a.run_id = p_run and a.contractor_id = c.id);
  if missing > 0 then
    raise exception '% contractor(s) have no attendance entry; enter 0 for no absences', missing;
  end if;

  update public.payout_run
  set status = 'attendance_confirmed', attendance_confirmed_by = auth.uid(), attendance_confirmed_at = now()
  where id = p_run;
end;
$$;

create function public.approve_run(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.payout_run;
begin
  if not public.has_role('owner') then raise exception 'Only the Owner can approve a payout run'; end if;
  select * into r from public.payout_run where id = p_run for update;
  if r.status <> 'review' then raise exception 'Run must be in review to approve'; end if;
  if exists (
    select 1 from public.payout_line l, jsonb_array_elements(l.flags) f
    where l.run_id = p_run and f ->> 'severity' = 'block'
  ) then
    raise exception 'Run has blocking flags';
  end if;
  if not exists (select 1 from public.payout_line where run_id = p_run) then
    raise exception 'Run has no payout lines';
  end if;
  update public.payout_run set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_run;
  update public.approval set decision = 'approved', decided_by = auth.uid(), decided_at = now()
  where type = 'payout_run' and ref_id = p_run and decision is null;
end;
$$;

create function public.return_run(p_run uuid, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner') then raise exception 'Only the Owner can return a payout run'; end if;
  if public.run_status_of(p_run) not in ('attendance_confirmed', 'review') then
    raise exception 'Only a confirmed or in-review run can be returned';
  end if;
  delete from public.payout_line where run_id = p_run;
  update public.payout_run
  set status = 'draft', return_comment = p_comment, attendance_confirmed_by = null, attendance_confirmed_at = null
  where id = p_run;
  update public.approval set decision = 'returned', comment = p_comment, decided_by = auth.uid(), decided_at = now()
  where type = 'payout_run' and ref_id = p_run and decision is null;
end;
$$;

create function public.mark_run_paid(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner') then raise exception 'Only the Owner can mark a run paid'; end if;
  if public.run_status_of(p_run) <> 'approved' then raise exception 'Run must be approved first'; end if;
  update public.payout_run set status = 'paid', paid_at = now() where id = p_run;
end;
$$;

-- Team Lead sees names only: no fees, roles, or bank data.
create view public.attendance_roster with (security_barrier) as
  select r.id as run_id, c.id as contractor_id, c.name,
         (c.user_id is not distinct from auth.uid()) as is_self,
         a.days_absent, a.note
  from public.payout_run r
  join public.contractor c
    on c.contract_start <= r.period_end and (c.contract_end is null or c.contract_end >= r.period_start)
  left join public.attendance a on a.run_id = r.id and a.contractor_id = c.id
  where public.has_role('team_lead') or public.is_payout_admin();

-- ───────────────────────── Row-level security ─────────────────────────

alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;
alter table public.pay_band enable row level security;
alter table public.contractor enable row level security;
alter table public.contractor_bank enable row level security;
alter table public.payout_run enable row level security;
alter table public.attendance enable row level security;
alter table public.reimbursement enable row level security;
alter table public.adjustment enable row level security;
alter table public.payout_line enable row level security;
alter table public.tax_config enable row level security;
alter table public.approval enable row level security;

create policy "see own roles" on public.user_roles for select using (user_id = auth.uid() or public.has_role('owner'));
create policy "owner manages roles" on public.user_roles for all using (public.has_role('owner')) with check (public.has_role('owner'));

create policy "owner reads audit" on public.audit_log for select using (public.has_role('owner'));

create policy "admins read bands" on public.pay_band for select using (public.is_payout_admin());
create policy "owner writes bands" on public.pay_band for all using (public.has_role('owner')) with check (public.has_role('owner'));

create policy "admins manage contractors" on public.contractor for all
  using (public.is_payout_admin()) with check (public.is_payout_admin());
create policy "admins manage bank" on public.contractor_bank for all
  using (public.is_payout_admin()) with check (public.is_payout_admin());

create policy "payout roles read runs" on public.payout_run for select
  using (public.is_payout_admin() or public.has_role('team_lead'));
create policy "admins create runs" on public.payout_run for insert with check (public.is_payout_admin());
-- Status changes go through the transition functions above; direct updates limited to admins
-- and never into approved/paid.
create policy "admins update runs" on public.payout_run for update
  using (public.is_payout_admin()) with check (public.is_payout_admin() and status in ('draft', 'attendance_confirmed', 'review'));

create policy "attendance readers" on public.attendance for select
  using (public.is_payout_admin() or public.has_role('team_lead'));
create policy "attendance writers" on public.attendance for insert
  with check (
    public.has_role('owner')
    or (public.has_role('team_lead')
        and not public.is_self_contractor(contractor_id))
  );
create policy "attendance editors" on public.attendance for update
  using (
    public.has_role('owner')
    or (public.has_role('team_lead')
        and not public.is_self_contractor(contractor_id))
  )
  with check (
    public.has_role('owner')
    or (public.has_role('team_lead')
        and not public.is_self_contractor(contractor_id))
  );

create policy "admins manage reimbursements" on public.reimbursement for all
  using (public.is_payout_admin()) with check (public.is_payout_admin());
create policy "admins manage adjustments" on public.adjustment for all
  using (public.is_payout_admin()) with check (public.is_payout_admin());
create policy "admins manage lines" on public.payout_line for all
  using (public.is_payout_admin()) with check (public.is_payout_admin());

create policy "admins read tax config" on public.tax_config for select using (public.is_payout_admin());
create policy "owner writes tax config" on public.tax_config for all using (public.has_role('owner')) with check (public.has_role('owner'));

create policy "approvers read approvals" on public.approval for select
  using (public.has_role(approver_role) or public.has_role('owner'));
create policy "requesters create approvals" on public.approval for insert with check (auth.uid() is not null);

-- ───────────────────────── Grants ─────────────────────────

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.attendance_roster to authenticated;
grant execute on function public.has_role(public.app_role), public.is_payout_admin(), public.is_self_contractor(uuid),
  public.confirm_attendance(uuid), public.approve_run(uuid), public.return_run(uuid, text),
  public.mark_run_paid(uuid) to authenticated;
