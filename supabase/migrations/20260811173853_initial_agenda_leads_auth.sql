create schema if not exists private;

create table public.admin_allowlist (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint admin_allowlist_email_check check (email = lower(email) and position('@' in email) > 1)
);

create table public.services (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  description text not null default '',
  price_cents bigint,
  duration_minutes integer,
  deposit_percent smallint not null default 10,
  min_deposit_cents bigint not null default 5000,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_slug_check check (slug ~ '^[a-z0-9-]+$'),
  constraint services_price_check check (price_cents is null or price_cents > 0),
  constraint services_duration_check check (duration_minutes is null or duration_minutes between 5 and 720),
  constraint services_deposit_percent_check check (deposit_percent between 1 and 100),
  constraint services_min_deposit_check check (min_deposit_cents >= 0)
);

create table public.leads (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null,
  service_slug text not null references public.services(slug) on update cascade,
  experience text not null,
  timing text not null,
  source jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_name_check check (char_length(name) between 2 and 120),
  constraint leads_phone_check check (phone ~ '^[0-9]{10,13}$'),
  constraint leads_experience_check check (experience in ('primeira', 'ja_fiz')),
  constraint leads_timing_check check (timing in ('semana', 'quinzena', 'pesquisando')),
  constraint leads_status_check check (status in ('new', 'contacted', 'qualified', 'scheduled', 'lost'))
);

create table public.slots (
  id bigint generated always as identity primary key,
  service_id bigint not null references public.services(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slots_dates_check check (ends_at > starts_at),
  constraint slots_status_check check (status in ('open', 'blocked', 'completed')),
  constraint slots_service_starts_unique unique (service_id, starts_at)
);

create table public.bookings (
  id bigint generated always as identity primary key,
  lead_id bigint not null references public.leads(id) on delete restrict,
  service_id bigint not null references public.services(id) on delete restrict,
  slot_id bigint not null references public.slots(id) on delete restrict,
  status text not null default 'awaiting_payment',
  price_cents bigint not null,
  deposit_cents bigint not null,
  payment_expires_at timestamptz not null,
  reschedule_deadline timestamptz not null,
  reschedule_count smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_status_check check (status in ('awaiting_payment', 'confirmed', 'cancelled', 'rescheduled', 'completed', 'no_show', 'expired')),
  constraint bookings_price_check check (price_cents > 0),
  constraint bookings_deposit_check check (deposit_cents > 0 and deposit_cents <= price_cents),
  constraint bookings_reschedule_count_check check (reschedule_count >= 0)
);

create unique index bookings_active_slot_unique
  on public.bookings (slot_id)
  where status in ('awaiting_payment', 'confirmed', 'rescheduled');

create table public.payments (
  id bigint generated always as identity primary key,
  booking_id bigint not null unique references public.bookings(id) on delete cascade,
  provider text,
  status text not null default 'awaiting_provider',
  amount_cents bigint not null,
  external_id text,
  pix_copy_paste text,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_status_check check (status in ('awaiting_provider', 'pending', 'paid', 'expired', 'refunded', 'failed')),
  constraint payments_amount_check check (amount_cents > 0)
);

create table public.clinic_settings (
  id boolean primary key default true,
  timezone text not null default 'America/Sao_Paulo',
  whatsapp text not null default '5511934580476',
  payment_provider text,
  pix_enabled boolean not null default false,
  deposit_percent smallint not null default 10,
  min_deposit_cents bigint not null default 5000,
  reservation_expiry_minutes integer not null default 30,
  reschedule_notice_hours integer not null default 48,
  updated_at timestamptz not null default now(),
  constraint clinic_settings_singleton_check check (id),
  constraint clinic_settings_deposit_percent_check check (deposit_percent between 1 and 100),
  constraint clinic_settings_min_deposit_check check (min_deposit_cents >= 0),
  constraint clinic_settings_expiry_check check (reservation_expiry_minutes between 5 and 1440),
  constraint clinic_settings_reschedule_check check (reschedule_notice_hours between 0 and 720)
);

create index leads_status_created_at_idx on public.leads (status, created_at desc);
create index leads_phone_created_at_idx on public.leads (phone, created_at desc);
create index slots_service_starts_at_idx on public.slots (service_id, starts_at);
create index slots_open_starts_at_idx on public.slots (starts_at) where status = 'open';
create index bookings_lead_id_idx on public.bookings (lead_id);
create index bookings_service_id_idx on public.bookings (service_id);
create index bookings_status_created_at_idx on public.bookings (status, created_at desc);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger services_touch_updated_at before update on public.services
for each row execute function private.touch_updated_at();
create trigger leads_touch_updated_at before update on public.leads
for each row execute function private.touch_updated_at();
create trigger slots_touch_updated_at before update on public.slots
for each row execute function private.touch_updated_at();
create trigger bookings_touch_updated_at before update on public.bookings
for each row execute function private.touch_updated_at();
create trigger payments_touch_updated_at before update on public.payments
for each row execute function private.touch_updated_at();
create trigger clinic_settings_touch_updated_at before update on public.clinic_settings
for each row execute function private.touch_updated_at();

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.admin_allowlist a
      where a.active
        and a.email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
    );
$$;

revoke all on function private.is_admin() from public, anon, authenticated;
revoke all on function private.touch_updated_at() from public, anon, authenticated;

alter table public.admin_allowlist enable row level security;
alter table public.services enable row level security;
alter table public.leads enable row level security;
alter table public.slots enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.clinic_settings enable row level security;

create policy admin_allowlist_self_read on public.admin_allowlist
for select to authenticated
using (email = lower(coalesce((select auth.jwt() ->> 'email'), '')));

create policy services_public_read on public.services
for select to anon, authenticated
using (active);

create policy services_admin_all on public.services
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy leads_admin_all on public.leads
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy slots_public_read on public.slots
for select to anon, authenticated
using (status = 'open' and starts_at > now());

create policy slots_admin_all on public.slots
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy bookings_admin_all on public.bookings
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy payments_admin_all on public.payments
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy clinic_settings_admin_all on public.clinic_settings
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create or replace function public.capture_lead(
  p_name text,
  p_phone text,
  p_service_slug text,
  p_experience text,
  p_timing text,
  p_source jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_name text := btrim(coalesce(p_name, ''));
  v_id bigint;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Nome inválido';
  end if;
  if v_phone !~ '^[0-9]{10,13}$' then
    raise exception 'WhatsApp inválido';
  end if;
  if p_experience not in ('primeira', 'ja_fiz') then
    raise exception 'Experiência inválida';
  end if;
  if p_timing not in ('semana', 'quinzena', 'pesquisando') then
    raise exception 'Prazo inválido';
  end if;
  if pg_column_size(coalesce(p_source, '{}'::jsonb)) > 4096 then
    raise exception 'Origem inválida';
  end if;
  if not exists (select 1 from public.services where slug = p_service_slug and active) then
    raise exception 'Serviço inválido';
  end if;

  select id into v_id
  from public.leads
  where phone = v_phone
    and service_slug = p_service_slug
    and created_at > now() - interval '10 minutes'
  order by created_at desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.leads (name, phone, service_slug, experience, timing, source)
  values (v_name, v_phone, p_service_slug, p_experience, p_timing, coalesce(p_source, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.list_open_slots(p_service_slug text)
returns table (
  slot_id bigint,
  service_slug text,
  service_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  price_cents bigint,
  deposit_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sl.id,
    s.slug,
    s.name,
    sl.starts_at,
    sl.ends_at,
    s.price_cents,
    greatest(
      ceil((s.price_cents * s.deposit_percent)::numeric / 100)::bigint,
      s.min_deposit_cents
    )
  from public.slots sl
  join public.services s on s.id = sl.service_id
  where s.slug = p_service_slug
    and s.active
    and s.price_cents is not null
    and s.duration_minutes is not null
    and sl.status = 'open'
    and sl.starts_at > now()
    and not exists (
      select 1 from public.bookings b
      where b.slot_id = sl.id
        and b.status in ('awaiting_payment', 'confirmed', 'rescheduled')
        and (b.status <> 'awaiting_payment' or b.payment_expires_at > now())
    )
  order by sl.starts_at
  limit 60;
$$;

revoke all on function public.capture_lead(text, text, text, text, text, jsonb) from public;
revoke all on function public.list_open_slots(text) from public;
grant execute on function public.capture_lead(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.list_open_slots(text) to anon, authenticated;

revoke all on table public.admin_allowlist from anon, authenticated;
revoke all on table public.services from anon, authenticated;
revoke all on table public.leads from anon, authenticated;
revoke all on table public.slots from anon, authenticated;
revoke all on table public.bookings from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.clinic_settings from anon, authenticated;

grant select on table public.services to anon, authenticated;
grant select on table public.slots to anon, authenticated;
grant select on table public.admin_allowlist to authenticated;
grant select, insert, update, delete on table public.services to authenticated;
grant select, insert, update, delete on table public.leads to authenticated;
grant select, insert, update, delete on table public.slots to authenticated;
grant select, insert, update, delete on table public.bookings to authenticated;
grant select, insert, update, delete on table public.payments to authenticated;
grant select, update on table public.clinic_settings to authenticated;
grant usage, select on all sequences in schema public to authenticated;

insert into public.admin_allowlist (email)
values ('sistemapsestetica@gmail.com')
on conflict (email) do update set active = excluded.active;

insert into public.services (slug, name, description)
values
  ('lavieen', 'Lavieen Day', 'Manchas, poros e renovação da textura da pele.'),
  ('laser', 'Laser Day', 'Depilação a laser com plano personalizado por regiões.'),
  ('ultraformer', 'Ultraformer Day', 'Firmeza, contorno e estímulo de colágeno.'),
  ('botox', 'Botox Day', 'Suavização de linhas com resultado natural.')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description;

insert into public.clinic_settings (id)
values (true)
on conflict (id) do nothing;;
