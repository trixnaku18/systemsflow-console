-- Inbound GHL webhook events, stored as received. Written only by the server (service role).

create table public.ghl_event (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique,
  event_type text,
  location_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.ghl_event enable row level security;
create policy "owner reads ghl events" on public.ghl_event for select using (public.has_role('owner'));
revoke insert, update, delete on public.ghl_event from authenticated;
