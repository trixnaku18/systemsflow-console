-- Bank account numbers live only in Supabase Vault. The app sees the last 4 digits;
-- the full number is read back only to build an approved run's bank file.
-- Requires a Vault secret named 'bank_fingerprint_key' (any long random string):
--   select vault.create_secret('<random 32+ chars>', 'bank_fingerprint_key');

alter table public.contractor_bank add column account_last4 text not null default '';

create function public.set_contractor_bank(p_contractor uuid, p_account_name text, p_account_number text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  digits text := regexp_replace(p_account_number, '[\s-]', '', 'g');
  fp_key text;
  existing public.contractor_bank;
  new_ref uuid;
begin
  if not public.is_payout_admin() then raise exception 'Only Owner or Finance can change bank details'; end if;
  if digits !~ '^\d{10,16}$' then raise exception 'Account number must be 10–16 digits'; end if;
  if length(trim(p_account_name)) = 0 then raise exception 'Account name is required'; end if;

  select decrypted_secret into fp_key from vault.decrypted_secrets where name = 'bank_fingerprint_key';
  if fp_key is null then raise exception 'Vault secret bank_fingerprint_key is not set'; end if;

  select * into existing from public.contractor_bank where contractor_id = p_contractor;
  if found then
    perform vault.update_secret(existing.bank_ref, digits);
    update public.contractor_bank
    set account_name = trim(p_account_name),
        fingerprint = encode(hmac(digits, fp_key, 'sha256'), 'hex'),
        account_last4 = right(digits, 4),
        updated_at = now()
    where contractor_id = p_contractor;
  else
    new_ref := vault.create_secret(digits, 'bank:' || p_contractor::text);
    insert into public.contractor_bank (contractor_id, account_name, bank_ref, fingerprint, account_last4)
    values (p_contractor, trim(p_account_name), new_ref,
            encode(hmac(digits, fp_key, 'sha256'), 'hex'), right(digits, 4));
  end if;
end;
$$;

-- Rows for the UnionBank bulk file. Owner only, approved runs only.
create function public.bank_rows_for_run(p_run uuid)
returns table (contractor_id uuid, account_name text, account_number text, net bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner') then raise exception 'Only the Owner can export the bank file'; end if;
  if public.run_status_of(p_run) not in ('approved', 'paid') then
    raise exception 'Bank file is available only for approved runs';
  end if;
  insert into public.audit_log (actor, action, entity, entity_id)
  values (auth.uid(), 'export_bank_file', 'payout_run', p_run::text);
  return query
    select l.contractor_id, b.account_name, s.decrypted_secret, l.net
    from public.payout_line l
    join public.contractor_bank b on b.contractor_id = l.contractor_id
    join vault.decrypted_secrets s on s.id = b.bank_ref
    where l.run_id = p_run and l.net > 0
    order by l.name;
end;
$$;

revoke execute on function public.set_contractor_bank(uuid, text, text), public.bank_rows_for_run(uuid) from public, anon;
grant execute on function public.set_contractor_bank(uuid, text, text), public.bank_rows_for_run(uuid) to authenticated;
