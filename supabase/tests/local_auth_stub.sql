-- Minimal stand-in for Supabase's auth schema so migrations can be tested on plain Postgres.
-- Never run this against a real Supabase project.
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
-- Vault stand-in (plain text — test only).
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null) returns uuid
language sql as $$ insert into vault.secrets (name, secret) values (new_name, new_secret) returning id $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text) returns void
language sql as $$ update vault.secrets set secret = new_secret where id = secret_id $$;
insert into vault.secrets (name, secret) values ('bank_fingerprint_key', 'test-key-not-secret') on conflict do nothing;
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
