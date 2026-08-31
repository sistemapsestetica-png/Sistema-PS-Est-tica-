-- Agenda master, agendas por profissional, links diretos e preparação do Pix automático.

create extension if not exists pgcrypto;

do $$ begin
  create type public.staff_role as enum ('receptionist', 'professional');
exception when duplicate_object then null;
end $$;

create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null unique check (email = lower(email)),
  role public.staff_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_invites (
  email text primary key check (email = lower(email)),
  full_name text not null check (char_length(full_name) between 2 and 120),
  role public.staff_role not null,
  service_id bigint references public.services(id) on delete set null,
  active boolean not null default true,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.professional_services (
  professional_id uuid not null references public.staff_profiles(user_id) on delete cascade,
  service_id bigint not null references public.services(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (professional_id, service_id)
);

alter table public.leads add column if not exists email text;
alter table public.slots add column if not exists professional_id uuid references public.staff_profiles(user_id) on delete set null;
alter table public.bookings add column if not exists professional_id uuid references public.staff_profiles(user_id) on delete set null;
alter table public.bookings add column if not exists public_token uuid not null default gen_random_uuid();
alter table public.bookings add column if not exists booking_source text not null default 'quiz';
alter table public.bookings add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.payments add column if not exists qr_code_base64 text;
alter table public.payments add column if not exists ticket_url text;
alter table public.payments add column if not exists provider_status text;

do $$ begin
  alter table public.bookings add constraint bookings_public_token_key unique (public_token);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.bookings add constraint bookings_source_check
    check (booking_source in ('quiz', 'direct', 'reception'));
exception when duplicate_object then null;
end $$;

create table if not exists public.booking_links (
  id bigint generated always as identity primary key,
  token uuid not null unique default gen_random_uuid(),
  label text not null default 'Agenda direta',
  service_id bigint references public.services(id) on delete cascade,
  professional_id uuid references public.staff_profiles(user_id) on delete cascade,
  active boolean not null default true,
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists slots_professional_starts_idx on public.slots(professional_id, starts_at);
create index if not exists bookings_professional_created_idx on public.bookings(professional_id, created_at desc);
create index if not exists professional_services_service_idx on public.professional_services(service_id, professional_id);
create index if not exists payments_external_id_idx on public.payments(external_id);
create index if not exists staff_invites_service_idx on public.staff_invites(service_id);
create index if not exists staff_invites_invited_by_idx on public.staff_invites(invited_by);
create index if not exists booking_links_service_idx on public.booking_links(service_id);
create index if not exists booking_links_professional_idx on public.booking_links(professional_id);
create index if not exists booking_links_created_by_idx on public.booking_links(created_by);

grant select on public.staff_profiles, public.professional_services to authenticated;
grant select, insert, update, delete on public.staff_invites, public.booking_links to authenticated;
grant usage, select on sequence public.booking_links_id_seq to authenticated;

create or replace function private.current_staff_role()
returns public.staff_role
language sql stable security definer set search_path = ''
as $$
  select sp.role
  from public.staff_profiles sp
  where sp.user_id = (select auth.uid()) and sp.active
  limit 1;
$$;

create or replace function private.is_receptionist()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select private.current_staff_role()) = 'receptionist'::public.staff_role, false)
    or (select private.is_admin());
$$;

create or replace function private.is_assigned_professional(p_service_id bigint, p_professional_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.professional_services ps
    join public.staff_profiles sp on sp.user_id = ps.professional_id
    where ps.professional_id = p_professional_id
      and ps.service_id = p_service_id
      and ps.active and sp.active and sp.role = 'professional'
  );
$$;

create or replace function public.handle_new_staff_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_invite public.staff_invites%rowtype;
begin
  select * into v_invite from public.staff_invites
  where email = lower(new.email) and active;

  if found then
    insert into public.staff_profiles(user_id, full_name, email, role)
    values (new.id, v_invite.full_name, lower(new.email), v_invite.role)
    on conflict (user_id) do update set
      full_name = excluded.full_name, email = excluded.email,
      role = excluded.role, active = true, updated_at = now();

    if v_invite.role = 'professional' and v_invite.service_id is not null then
      insert into public.professional_services(professional_id, service_id)
      values (new.id, v_invite.service_id)
      on conflict (professional_id, service_id) do update set active = true;
    end if;
  elsif exists (select 1 from public.admin_allowlist a where a.email = lower(new.email) and a.active) then
    insert into public.staff_profiles(user_id, full_name, email, role)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), lower(new.email), 'receptionist')
    on conflict (user_id) do update set role = 'receptionist', active = true, updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_staff on auth.users;
create trigger on_auth_user_created_staff
after insert or update of email on auth.users
for each row execute function public.handle_new_staff_user();

create or replace function public.sync_existing_staff_invite()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid;
begin
  if not new.active then return new; end if;
  select id into v_user_id from auth.users where lower(email) = new.email limit 1;
  if v_user_id is null then return new; end if;
  insert into public.staff_profiles(user_id,full_name,email,role)
  values(v_user_id,new.full_name,new.email,new.role)
  on conflict(user_id) do update set full_name=excluded.full_name,email=excluded.email,role=excluded.role,active=true,updated_at=now();
  if new.role='professional' and new.service_id is not null then
    insert into public.professional_services(professional_id,service_id)
    values(v_user_id,new.service_id)
    on conflict(professional_id,service_id) do update set active=true;
  end if;
  return new;
end;
$$;

drop trigger if exists on_staff_invite_sync on public.staff_invites;
create trigger on_staff_invite_sync
after insert or update on public.staff_invites
for each row execute function public.sync_existing_staff_invite();

insert into public.staff_profiles(user_id, full_name, email, role)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)), lower(u.email), 'receptionist'
from auth.users u join public.admin_allowlist a on a.email = lower(u.email) and a.active
on conflict (user_id) do update set role = 'receptionist', active = true, updated_at = now();

alter table public.staff_profiles enable row level security;
alter table public.staff_invites enable row level security;
alter table public.professional_services enable row level security;
alter table public.booking_links enable row level security;

drop policy if exists staff_profiles_self_or_reception on public.staff_profiles;
create policy staff_profiles_self_or_reception on public.staff_profiles for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_receptionist()));
drop policy if exists staff_profiles_reception_all on public.staff_profiles;
create policy staff_profiles_reception_all on public.staff_profiles for all to authenticated
using ((select private.is_receptionist())) with check ((select private.is_receptionist()));

drop policy if exists staff_invites_reception_all on public.staff_invites;
create policy staff_invites_reception_all on public.staff_invites for all to authenticated
using ((select private.is_receptionist())) with check ((select private.is_receptionist()));

drop policy if exists professional_services_staff_read on public.professional_services;
create policy professional_services_staff_read on public.professional_services for select to authenticated
using (professional_id = (select auth.uid()) or (select private.is_receptionist()));
drop policy if exists professional_services_reception_all on public.professional_services;
create policy professional_services_reception_all on public.professional_services for all to authenticated
using ((select private.is_receptionist())) with check ((select private.is_receptionist()));

drop policy if exists booking_links_reception_all on public.booking_links;
create policy booking_links_reception_all on public.booking_links for all to authenticated
using ((select private.is_receptionist())) with check ((select private.is_receptionist()));

drop policy if exists services_staff_read on public.services;
create policy services_staff_read on public.services for select to authenticated
using (exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid()) and sp.active));

drop policy if exists slots_professional_read on public.slots;
create policy slots_professional_read on public.slots for select to authenticated
using (professional_id = (select auth.uid()) and (select private.is_assigned_professional(service_id)));
drop policy if exists slots_professional_insert on public.slots;
create policy slots_professional_insert on public.slots for insert to authenticated
with check (professional_id = (select auth.uid()) and (select private.is_assigned_professional(service_id)));
drop policy if exists slots_professional_update on public.slots;
create policy slots_professional_update on public.slots for update to authenticated
using (professional_id = (select auth.uid()) and (select private.is_assigned_professional(service_id)))
with check (professional_id = (select auth.uid()) and (select private.is_assigned_professional(service_id)));

drop policy if exists bookings_professional_read on public.bookings;
create policy bookings_professional_read on public.bookings for select to authenticated
using (professional_id = (select auth.uid()));
drop policy if exists leads_professional_booked_read on public.leads;
create policy leads_professional_booked_read on public.leads for select to authenticated
using (exists (select 1 from public.bookings b where b.lead_id = leads.id and b.professional_id = (select auth.uid())));
drop policy if exists payments_professional_read on public.payments;
create policy payments_professional_read on public.payments for select to authenticated
using (exists (select 1 from public.bookings b where b.id = payments.booking_id and b.professional_id = (select auth.uid())));

create or replace function public.release_expired_reservations()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  with expired as (
    update public.bookings b set status = 'expired', updated_at = now()
    where b.status = 'awaiting_payment' and b.payment_expires_at <= now()
    returning b.slot_id
  )
  update public.slots s set status = 'open', updated_at = now()
  where s.id in (select slot_id from expired)
    and not exists (select 1 from public.bookings b where b.slot_id = s.id and b.status in ('confirmed','pending','rescheduled'));
  get diagnostics v_count = row_count;
  update public.payments p set status = 'expired', updated_at = now()
  where p.status in ('awaiting_provider','pending') and p.expires_at <= now();
  return v_count;
end;
$$;

drop function if exists public.capture_lead(text,text,text,text,text,jsonb);
create function public.capture_lead(p_name text,p_phone text,p_service_slug text,p_experience text,p_timing text,p_source jsonb default '{}'::jsonb,p_email text default null)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'); v_name text:=btrim(coalesce(p_name,'')); v_id bigint;
begin
  if char_length(v_name) not between 2 and 120 then raise exception 'Nome inválido'; end if;
  if v_phone !~ '^[0-9]{10,13}$' then raise exception 'WhatsApp inválido'; end if;
  if p_email is not null and p_email !~* '^[^@ ]+@[^@ ]+\.[^@ ]+$' then raise exception 'E-mail inválido'; end if;
  if p_experience not in ('primeira','ja_fiz') or p_timing not in ('semana','quinzena','pesquisando') then raise exception 'Respostas inválidas'; end if;
  if not exists(select 1 from public.services where slug=p_service_slug and active) then raise exception 'Serviço inválido'; end if;
  select id into v_id from public.leads where phone=v_phone and service_slug=p_service_slug and created_at>now()-interval '10 minutes' order by created_at desc limit 1;
  if v_id is not null then update public.leads set email=coalesce(lower(nullif(btrim(p_email),'')),email),updated_at=now() where id=v_id; return v_id; end if;
  insert into public.leads(name,phone,email,service_slug,experience,timing,source) values(v_name,v_phone,lower(nullif(btrim(p_email),'')),p_service_slug,p_experience,p_timing,coalesce(p_source,'{}'::jsonb)) returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.list_open_slots(text);
create function public.list_open_slots(p_service_slug text)
returns table(slot_id bigint, service_slug text, service_name text, professional_id uuid, professional_name text, starts_at timestamptz, ends_at timestamptz, price_cents bigint, deposit_cents bigint)
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.release_expired_reservations();
  return query
  select sl.id, s.slug, s.name, sl.professional_id, coalesce(sp.full_name, 'Equipe PS Estética'),
         sl.starts_at, sl.ends_at, s.price_cents,
         greatest(ceil((s.price_cents * s.deposit_percent)::numeric / 100)::bigint, s.min_deposit_cents)
  from public.slots sl join public.services s on s.id = sl.service_id
  left join public.staff_profiles sp on sp.user_id = sl.professional_id and sp.active
  where s.slug = p_service_slug and s.active and s.price_cents is not null
    and s.duration_minutes is not null and sl.status = 'open' and sl.starts_at > now()
    and not exists (select 1 from public.bookings b where b.slot_id = sl.id and b.status in ('pending','awaiting_payment','confirmed','rescheduled') and (b.status <> 'awaiting_payment' or b.payment_expires_at > now()))
  order by sl.starts_at limit 60;
end;
$$;

drop function if exists public.reserve_slot(bigint,bigint);
create function public.reserve_slot(p_lead_id bigint, p_slot_id bigint)
returns table(booking_id bigint, booking_token uuid, booking_status text, service_name text, professional_name text, starts_at timestamptz, ends_at timestamptz, price_cents bigint, deposit_cents bigint, payment_expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_slot public.slots%rowtype; v_service public.services%rowtype; v_lead public.leads%rowtype;
        v_id bigint; v_token uuid; v_deposit bigint; v_exp integer; v_notice integer; v_prof_name text;
begin
  perform public.release_expired_reservations();
  select * into v_lead from public.leads where id = p_lead_id;
  if not found then raise exception 'Lead não encontrado'; end if;
  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found or v_slot.status <> 'open' or v_slot.starts_at <= now() then raise exception 'Horário indisponível'; end if;
  select * into v_service from public.services where id = v_slot.service_id and active;
  if not found or v_service.slug <> v_lead.service_slug or v_service.price_cents is null then raise exception 'Procedimento indisponível'; end if;
  select reservation_expiry_minutes, reschedule_notice_hours into v_exp, v_notice from public.clinic_settings where id=true;
  v_exp := coalesce(v_exp,30); v_notice := coalesce(v_notice,48);
  v_deposit := greatest(ceil((v_service.price_cents*v_service.deposit_percent)::numeric/100)::bigint,v_service.min_deposit_cents);
  v_token := gen_random_uuid();
  update public.slots set status='reserved',updated_at=now() where id=p_slot_id;
  insert into public.bookings(lead_id,slot_id,service_id,professional_id,status,price_cents,deposit_cents,payment_expires_at,reschedule_deadline,public_token,booking_source)
  values(p_lead_id,p_slot_id,v_service.id,v_slot.professional_id,'awaiting_payment',v_service.price_cents,v_deposit,now()+make_interval(mins=>v_exp),v_slot.starts_at-make_interval(hours=>v_notice),v_token,'quiz') returning id into v_id;
  update public.leads set status='scheduled',updated_at=now() where id=p_lead_id;
  select coalesce(full_name,'Equipe PS Estética') into v_prof_name from public.staff_profiles where user_id=v_slot.professional_id;
  return query select v_id,v_token,'awaiting_payment'::text,v_service.name,coalesce(v_prof_name,'Equipe PS Estética'),v_slot.starts_at,v_slot.ends_at,v_service.price_cents,v_deposit,now()+make_interval(mins=>v_exp);
end;
$$;

create or replace function public.create_direct_booking(p_service_slug text, p_slot_id bigint, p_name text, p_phone text, p_email text default null, p_link_token uuid default null)
returns table(booking_id bigint, booking_token uuid, service_name text, professional_name text, starts_at timestamptz, deposit_cents bigint, payment_expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_slot public.slots%rowtype; v_service public.services%rowtype; v_lead_id bigint; v_booking_id bigint;
        v_booking_token uuid; v_phone text; v_name text; v_exp integer; v_notice integer; v_deposit bigint; v_prof_name text; v_link public.booking_links%rowtype;
begin
  perform public.release_expired_reservations();
  v_phone := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'); v_name := btrim(coalesce(p_name,''));
  if char_length(v_name) not between 2 and 120 or v_phone !~ '^[0-9]{10,13}$' then raise exception 'Dados da cliente inválidos'; end if;
  if p_email is not null and p_email !~* '^[^@ ]+@[^@ ]+\.[^@ ]+$' then raise exception 'E-mail inválido'; end if;
  if p_link_token is not null then
    select * into v_link from public.booking_links where token=p_link_token and active and (expires_at is null or expires_at>now()) and (max_uses is null or uses<max_uses) for update;
    if not found then raise exception 'Link de agenda inválido ou expirado'; end if;
  end if;
  select * into v_slot from public.slots where id=p_slot_id for update;
  if not found or v_slot.status<>'open' or v_slot.starts_at<=now() then raise exception 'Horário indisponível'; end if;
  select * into v_service from public.services where id=v_slot.service_id and slug=p_service_slug and active and price_cents is not null;
  if not found then raise exception 'Procedimento indisponível'; end if;
  if p_link_token is not null and (v_link.service_id is not null and v_link.service_id<>v_service.id or v_link.professional_id is not null and v_link.professional_id is distinct from v_slot.professional_id) then raise exception 'Horário não pertence a este link'; end if;
  insert into public.leads(name,phone,email,service_slug,experience,timing,source,status)
  values(v_name,v_phone,lower(nullif(btrim(p_email),'')),v_service.slug,'primeira','semana',jsonb_build_object('channel','direct_schedule'),'scheduled') returning id into v_lead_id;
  select reservation_expiry_minutes,reschedule_notice_hours into v_exp,v_notice from public.clinic_settings where id=true;
  v_exp:=coalesce(v_exp,30); v_notice:=coalesce(v_notice,48); v_booking_token:=gen_random_uuid();
  v_deposit:=greatest(ceil((v_service.price_cents*v_service.deposit_percent)::numeric/100)::bigint,v_service.min_deposit_cents);
  update public.slots set status='reserved',updated_at=now() where id=v_slot.id;
  insert into public.bookings(lead_id,slot_id,service_id,professional_id,status,price_cents,deposit_cents,payment_expires_at,reschedule_deadline,public_token,booking_source)
  values(v_lead_id,v_slot.id,v_service.id,v_slot.professional_id,'awaiting_payment',v_service.price_cents,v_deposit,now()+make_interval(mins=>v_exp),v_slot.starts_at-make_interval(hours=>v_notice),v_booking_token,'direct') returning id into v_booking_id;
  if p_link_token is not null then update public.booking_links set uses=uses+1 where id=v_link.id; end if;
  select coalesce(full_name,'Equipe PS Estética') into v_prof_name from public.staff_profiles where user_id=v_slot.professional_id;
  return query select v_booking_id,v_booking_token,v_service.name,coalesce(v_prof_name,'Equipe PS Estética'),v_slot.starts_at,v_deposit,now()+make_interval(mins=>v_exp);
end;
$$;

create or replace function public.get_booking_public_status(p_booking_token uuid)
returns table(booking_status text, payment_status text, service_name text, professional_name text, starts_at timestamptz, deposit_cents bigint, payment_expires_at timestamptz, pix_copy_paste text, qr_code_base64 text, ticket_url text)
language sql stable security definer set search_path = ''
as $$
  select b.status,p.status,s.name,coalesce(sp.full_name,'Equipe PS Estética'),sl.starts_at,b.deposit_cents,b.payment_expires_at,p.pix_copy_paste,p.qr_code_base64,p.ticket_url
  from public.bookings b join public.services s on s.id=b.service_id join public.slots sl on sl.id=b.slot_id
  left join public.staff_profiles sp on sp.user_id=b.professional_id left join public.payments p on p.booking_id=b.id
  where b.public_token=p_booking_token;
$$;

create or replace function public.get_booking_link_options(p_link_token uuid)
returns table(service_slug text, service_name text, professional_id uuid, professional_name text, label text)
language sql stable security definer set search_path = ''
as $$
  select s.slug,s.name,bl.professional_id,sp.full_name,bl.label
  from public.booking_links bl
  left join public.services s on s.id=bl.service_id and s.active
  left join public.staff_profiles sp on sp.user_id=bl.professional_id and sp.active
  where bl.token=p_link_token and bl.active and (bl.expires_at is null or bl.expires_at>now()) and (bl.max_uses is null or bl.uses<bl.max_uses);
$$;

create or replace function public.professional_update_booking_status(p_booking_id bigint,p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_status not in ('confirmed','completed','no_show') then raise exception 'Status não permitido'; end if;
  update public.bookings set status=p_status,updated_at=now() where id=p_booking_id and professional_id=(select auth.uid());
  if not found then raise exception 'Agendamento não encontrado'; end if;
  if p_status='completed' then update public.slots set status='completed',updated_at=now() where id=(select slot_id from public.bookings where id=p_booking_id); end if;
end;
$$;

drop function if exists public.create_recurring_slots(bigint,integer,time,integer,integer,integer);
create function public.create_recurring_slots(
  p_service_id bigint, p_weekday integer, p_start_time time,
  p_weeks integer default 8, p_slots_per_day integer default 1,
  p_interval_minutes integer default 60, p_professional_id uuid default null
)
returns integer language plpgsql security invoker set search_path = ''
as $$
declare v_service public.services%rowtype; v_timezone text; v_today date; v_first_date date;
        v_starts_at timestamptz; v_inserted integer:=0; v_week integer; v_position integer; v_prof uuid;
begin
  if not (select private.is_receptionist()) and not (select private.is_assigned_professional(p_service_id)) then raise exception 'Acesso não autorizado'; end if;
  if p_weekday not between 0 and 6 or p_weeks not between 1 and 52 or p_slots_per_day not between 1 and 12 or p_interval_minutes not between 5 and 720 then raise exception 'Configuração inválida'; end if;
  select * into v_service from public.services where id=p_service_id and active and duration_minutes is not null;
  if not found then raise exception 'Configure a duração do procedimento'; end if;
  v_prof := case when (select private.is_receptionist()) then p_professional_id else (select auth.uid()) end;
  if v_prof is not null and not (select private.is_assigned_professional(p_service_id,v_prof)) then raise exception 'Profissional não atribuído ao procedimento'; end if;
  select timezone into v_timezone from public.clinic_settings where id=true; v_timezone:=coalesce(v_timezone,'America/Sao_Paulo');
  v_today:=now() at time zone v_timezone; v_first_date:=v_today+((p_weekday-extract(dow from v_today)::integer+7)%7);
  if (v_first_date+p_start_time) at time zone v_timezone<=now() then v_first_date:=v_first_date+7; end if;
  for v_week in 0..p_weeks-1 loop for v_position in 0..p_slots_per_day-1 loop
    v_starts_at:=(v_first_date+(v_week*7)+p_start_time+make_interval(mins=>v_position*p_interval_minutes)) at time zone v_timezone;
    insert into public.slots(service_id,professional_id,starts_at,ends_at,status,notes)
    values(v_service.id,v_prof,v_starts_at,v_starts_at+make_interval(mins=>v_service.duration_minutes),'open','Gerado automaticamente')
    on conflict(service_id,starts_at) do nothing;
    if found then v_inserted:=v_inserted+1; end if;
  end loop; end loop;
  return v_inserted;
end;
$$;

revoke all on function public.release_expired_reservations() from public,anon,authenticated;
revoke all on function public.handle_new_staff_user() from public,anon,authenticated;
revoke all on function public.sync_existing_staff_invite() from public,anon,authenticated;
revoke all on function public.list_open_slots(text) from public,anon,authenticated;
revoke all on function public.capture_lead(text,text,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.reserve_slot(bigint,bigint) from public,anon,authenticated;
revoke all on function public.create_direct_booking(text,bigint,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.get_booking_public_status(uuid) from public,anon,authenticated;
revoke all on function public.get_booking_link_options(uuid) from public,anon,authenticated;
revoke all on function public.professional_update_booking_status(bigint,text) from public,anon,authenticated;
revoke all on function public.create_recurring_slots(bigint,integer,time,integer,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.list_open_slots(text) to anon,authenticated;
grant execute on function public.capture_lead(text,text,text,text,text,jsonb,text) to anon,authenticated;
grant execute on function public.reserve_slot(bigint,bigint) to anon,authenticated;
grant execute on function public.create_direct_booking(text,bigint,text,text,text,uuid) to anon,authenticated;
grant execute on function public.get_booking_public_status(uuid) to anon,authenticated;
grant execute on function public.get_booking_link_options(uuid) to anon,authenticated;
grant execute on function public.professional_update_booking_status(bigint,text) to authenticated;
grant execute on function public.create_recurring_slots(bigint,integer,time,integer,integer,integer,uuid) to authenticated;
;
