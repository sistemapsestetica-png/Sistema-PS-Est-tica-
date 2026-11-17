-- Isolated campaign tracking. No changes to leads, bookings, payments or RPCs.
begin;
create table public.bf_tracking_groups (
  group_id text primary key,
  subject text not null,
  invite_hash text not null unique,
  registered_at timestamptz not null default now()
);
create table public.bf_tracking_visits (
  visit_id uuid primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  attribution jsonb not null default '{}'::jsonb,
  fbp text, fbc text,
  expires_at timestamptz not null default now() + interval '30 days'
);
create table public.bf_group_entries (
  event_id text primary key,
  group_id text not null references public.bf_tracking_groups(group_id),
  participant_key text not null,
  phone_sha256 text check (phone_sha256 is null or phone_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  confirmed_at timestamptz not null,
  confirmation_state text not null check (confirmation_state = 'confirmed'),
  proof_method text not null check (proof_method = 'baileys_add+metadata'),
  attribution_state text not null default 'unattributed' check (attribution_state = 'unattributed'),
  visit_id uuid references public.bf_tracking_visits(visit_id),
  delivery_state text not null default 'queued' check (delivery_state in ('queued','sending','sent','failed','blocked','dead')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(group_id,participant_key),
  check (visit_id is null)
);
create index bf_visits_expiry_idx on public.bf_tracking_visits(expires_at);
alter table public.bf_tracking_groups enable row level security;
alter table public.bf_tracking_visits enable row level security;
alter table public.bf_group_entries enable row level security;
revoke all on public.bf_tracking_groups, public.bf_tracking_visits, public.bf_group_entries from public,anon,authenticated;
grant select,insert,update,delete on public.bf_tracking_groups, public.bf_tracking_visits, public.bf_group_entries to service_role;
commit;
