-- Role and workflow checks for the payouts schema. Run with psql -v ON_ERROR_STOP=1.
-- Each "expect error" block runs inside a savepoint and fails the script if no error is raised.
\set QUIET on
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@optogrow.test'),
  ('00000000-0000-0000-0000-000000000002', 'diego@optogrow.test'),
  ('00000000-0000-0000-0000-000000000003', 'viewer@optogrow.test');
insert into public.user_roles values
  ('00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-000000000002', 'team_lead'),
  ('00000000-0000-0000-0000-000000000003', 'viewer');

insert into public.contractor (id, name, user_id, pay_role, monthly_fee, contract_start) values
  ('10000000-0000-0000-0000-000000000001', 'Ana', null, 'it_tier_1', 1800000, '2026-01-01'),
  ('10000000-0000-0000-0000-000000000002', 'Diego', '00000000-0000-0000-0000-000000000002', 'tech_manager', 4500000, '2026-01-01');
insert into public.contractor_bank (contractor_id, account_name, bank_ref, fingerprint) values
  ('10000000-0000-0000-0000-000000000001', 'Ana', vault.create_secret('111122223333', 'bank:ana'), 'fp-ana');
insert into public.payout_run (id, period_start, period_end) values
  ('20000000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-15');

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.expect_error(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok   % (%)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL % — statement succeeded', label;
end $$;

create function pg_temp.expect_count(q text, n int, label text) returns void language plpgsql as $$
declare got int;
begin
  execute 'select count(*) from (' || q || ') s' into got;
  if got <> n then raise exception 'FAIL % — expected % rows, got %', label, n, got; end if;
  raise notice 'ok   %', label;
end $$;

-- ── Team Lead (Diego) ──
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select pg_temp.expect_count('select * from public.contractor', 0, 'team lead cannot read contractor fees');
select pg_temp.expect_count('select * from public.contractor_bank', 0, 'team lead cannot read bank data');
select pg_temp.expect_count('select * from public.payout_line', 0, 'team lead cannot read payout lines');
select pg_temp.expect_count('select * from public.attendance_roster', 2, 'team lead sees roster names');
insert into public.attendance (run_id, contractor_id, days_absent)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1.5);
select pg_temp.expect_error($$insert into public.attendance (run_id, contractor_id, days_absent)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 0)$$,
  'team lead cannot enter own attendance');
select pg_temp.expect_error($$update public.attendance set days_absent = 0.25
  where contractor_id = '10000000-0000-0000-0000-000000000001'$$, 'half-day steps only');
select pg_temp.expect_error($$select public.confirm_attendance('20000000-0000-0000-0000-000000000001')$$,
  'cannot confirm while someone has no entry');
select pg_temp.expect_error($$select public.approve_run('20000000-0000-0000-0000-000000000001')$$,
  'team lead cannot approve');
select pg_temp.expect_error($$select * from public.bank_rows_for_run('20000000-0000-0000-0000-000000000001')$$,
  'team lead cannot export bank file');
select pg_temp.expect_error($$select public.set_contractor_bank('10000000-0000-0000-0000-000000000001', 'x', '123456789012')$$,
  'team lead cannot change bank details');
reset role;

-- ── Viewer ──
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select pg_temp.expect_count('select * from public.attendance_roster', 0, 'viewer sees no roster');
select pg_temp.expect_count('select * from public.payout_run', 0, 'viewer sees no runs');
reset role;

-- ── Owner ──
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.attendance (run_id, contractor_id, days_absent)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 0);
select public.confirm_attendance('20000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$update public.attendance set days_absent = 2
  where contractor_id = '10000000-0000-0000-0000-000000000001'$$, 'attendance locked after confirmation');
select pg_temp.expect_error($$update public.payout_run set status = 'approved'
  where id = '20000000-0000-0000-0000-000000000001'$$, 'cannot set approved directly');
update public.payout_run set status = 'review' where id = '20000000-0000-0000-0000-000000000001';
insert into public.payout_line (run_id, contractor_id, name, monthly_fee, base, days_absent, daily_rate,
  absence_deduction, reimbursements, excluded_reimbursements, advances, other_deductions, owner_adjustments, net, flags)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ana', 1800000, 900000, 1.5,
   81818, 122727, 0, 0, 0, 0, 0, 777273, '[]'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Diego', 4500000, 2250000, 0,
   204545, 0, 0, 0, 0, 0, 0, 2250000, '[{"code":"bank_missing","severity":"block"}]');
select pg_temp.expect_error($$select public.approve_run('20000000-0000-0000-0000-000000000001')$$,
  'blocking flag stops approval');
update public.payout_line set flags = '[]' where contractor_id = '10000000-0000-0000-0000-000000000002';
select public.approve_run('20000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$update public.payout_line set net = 1
  where contractor_id = '10000000-0000-0000-0000-000000000001'$$, 'lines frozen after approval');
select public.mark_run_paid('20000000-0000-0000-0000-000000000001');
select pg_temp.expect_count($$select * from public.payout_run where status = 'paid'$$, 1, 'run marked paid');
select pg_temp.expect_count($$select * from public.audit_log where entity = 'attendance'$$, 2, 'attendance changes audited');
select pg_temp.expect_error($$select public.set_contractor_bank('10000000-0000-0000-0000-000000000002', 'Diego', '12-34')$$,
  'bank number validated');
select public.set_contractor_bank('10000000-0000-0000-0000-000000000002', 'Diego R', '1234 5678 9012');
select pg_temp.expect_count($$select * from public.contractor_bank where account_last4 = '9012' and fingerprint <> ''$$, 1,
  'bank stored as last4 + fingerprint');
select pg_temp.expect_count($$select * from public.contractor_bank b where to_jsonb(b)::text like '%56789012%'$$, 0,
  'no account number in table');
select pg_temp.expect_count($$select * from public.bank_rows_for_run('20000000-0000-0000-0000-000000000001')
  where account_number in ('123456789012', '111122223333')$$, 2, 'owner can export approved run');
reset role;

rollback;
\echo 'All RLS checks passed.'
