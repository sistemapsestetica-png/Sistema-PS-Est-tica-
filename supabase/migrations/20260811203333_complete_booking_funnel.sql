
alter table public.slots
  drop constraint if exists slots_status_check;

alter table public.slots
  add constraint slots_status_check
  check (status in ('open', 'reserved', 'blocked', 'completed'));

alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status in ('pending', 'awaiting_payment', 'confirmed', 'cancelled', 'rescheduled', 'completed', 'no_show', 'expired'));

drop index if exists public.bookings_active_slot_unique;

create unique index bookings_active_slot_unique
  on public.bookings (slot_id)
  where status in ('pending', 'awaiting_payment', 'confirmed', 'rescheduled');

create or replace function public.list_open_slots(p_service_slug text)
returns table(
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
      select 1
      from public.bookings b
      where b.slot_id = sl.id
        and b.status in ('pending', 'awaiting_payment', 'confirmed', 'rescheduled')
        and (
          b.status <> 'awaiting_payment'
          or b.payment_expires_at is null
          or b.payment_expires_at > now()
        )
    )
  order by sl.starts_at
  limit 60;
$$;

revoke all on function public.list_open_slots(text) from public, authenticated;
grant execute on function public.list_open_slots(text) to anon, service_role;

create or replace function public.reserve_slot(p_lead_id bigint, p_slot_id bigint)
returns table(
  booking_id bigint,
  booking_status text,
  service_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  price_cents bigint,
  deposit_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.slots%rowtype;
  v_service public.services%rowtype;
  v_lead public.leads%rowtype;
  v_booking_id bigint;
  v_deposit_cents bigint;
begin
  if p_lead_id is null or p_slot_id is null then
    raise exception using message = 'Dados da reserva inválidos', errcode = '22023';
  end if;

  select *
    into v_lead
  from public.leads
  where id = p_lead_id;

  if not found then
    raise exception using message = 'Lead não encontrado', errcode = 'P0002';
  end if;

  select sl.*
    into v_slot
  from public.slots sl
  where sl.id = p_slot_id
  for update;

  if not found
    or v_slot.status <> 'open'
    or v_slot.starts_at <= now() then
    raise exception using message = 'Horário indisponível', errcode = 'P0001';
  end if;

  select *
    into v_service
  from public.services
  where id = v_slot.service_id
    and active;

  if not found
    or v_service.slug <> v_lead.service_slug
    or v_service.price_cents is null
    or v_service.duration_minutes is null then
    raise exception using message = 'Procedimento indisponível para reserva', errcode = 'P0001';
  end if;

  v_deposit_cents := greatest(
    ceil((v_service.price_cents * v_service.deposit_percent)::numeric / 100)::bigint,
    v_service.min_deposit_cents
  );

  update public.slots
  set status = 'reserved',
      updated_at = now()
  where id = p_slot_id;

  insert into public.bookings (
    lead_id,
    slot_id,
    service_id,
    status,
    price_cents,
    deposit_cents,
    payment_expires_at,
    reschedule_deadline
  )
  values (
    p_lead_id,
    p_slot_id,
    v_service.id,
    'pending',
    v_service.price_cents,
    v_deposit_cents,
    null,
    v_slot.starts_at - interval '48 hours'
  )
  returning id into v_booking_id;

  update public.leads
  set status = 'scheduled',
      updated_at = now()
  where id = p_lead_id;

  return query
  select
    v_booking_id,
    'pending'::text,
    v_service.name,
    v_slot.starts_at,
    v_slot.ends_at,
    v_service.price_cents,
    v_deposit_cents;
exception
  when unique_violation then
    raise exception using message = 'Horário indisponível', errcode = '23505';
end;
$$;

revoke all on function public.reserve_slot(bigint, bigint) from public, authenticated;
grant execute on function public.reserve_slot(bigint, bigint) to anon, service_role;

create or replace function private.sync_booking_slot_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('cancelled', 'expired') then
    update public.slots
    set status = 'open',
        updated_at = now()
    where id = new.slot_id
      and starts_at > now()
      and not exists (
        select 1
        from public.bookings b
        where b.slot_id = new.slot_id
          and b.id <> new.id
          and b.status in ('pending', 'awaiting_payment', 'confirmed', 'rescheduled')
      );
  elsif new.status in ('pending', 'awaiting_payment', 'confirmed', 'rescheduled') then
    update public.slots
    set status = 'reserved',
        updated_at = now()
    where id = new.slot_id;
  elsif new.status = 'completed' then
    update public.slots
    set status = 'completed',
        updated_at = now()
    where id = new.slot_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_booking_slot_status on public.bookings;

create trigger sync_booking_slot_status
after insert or update of status on public.bookings
for each row execute function private.sync_booking_slot_status();

create or replace function public.create_recurring_slots(
  p_service_id bigint,
  p_weekday integer,
  p_start_time time,
  p_weeks integer default 8,
  p_slots_per_day integer default 1,
  p_interval_minutes integer default 60
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.services%rowtype;
  v_timezone text;
  v_today date;
  v_first_date date;
  v_starts_at timestamptz;
  v_inserted integer := 0;
  v_week integer;
  v_position integer;
begin
  if not private.is_admin() then
    raise exception using message = 'Acesso não autorizado', errcode = '42501';
  end if;

  if p_weekday not between 0 and 6
    or p_weeks not between 1 and 52
    or p_slots_per_day not between 1 and 12
    or p_interval_minutes not between 5 and 720 then
    raise exception using message = 'Configuração de recorrência inválida', errcode = '22023';
  end if;

  select *
    into v_service
  from public.services
  where id = p_service_id
    and active
    and duration_minutes is not null;

  if not found then
    raise exception using message = 'Configure a duração do procedimento antes de gerar horários', errcode = 'P0001';
  end if;

  select timezone
    into v_timezone
  from public.clinic_settings
  where id = true;

  v_timezone := coalesce(v_timezone, 'America/Sao_Paulo');
  v_today := now() at time zone v_timezone;
  v_first_date := v_today + ((p_weekday - extract(dow from v_today)::integer + 7) % 7);

  if (v_first_date + p_start_time) at time zone v_timezone <= now() then
    v_first_date := v_first_date + 7;
  end if;

  for v_week in 0..p_weeks - 1 loop
    for v_position in 0..p_slots_per_day - 1 loop
      v_starts_at := (
        v_first_date
        + (v_week * 7)
        + p_start_time
        + make_interval(mins => v_position * p_interval_minutes)
      ) at time zone v_timezone;

      insert into public.slots (service_id, starts_at, ends_at, status, notes)
      values (
        v_service.id,
        v_starts_at,
        v_starts_at + make_interval(mins => v_service.duration_minutes),
        'open',
        'Gerado automaticamente'
      )
      on conflict (service_id, starts_at) do nothing;

      if found then
        v_inserted := v_inserted + 1;
      end if;
    end loop;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.create_recurring_slots(bigint, integer, time, integer, integer, integer) from public, anon;
grant execute on function public.create_recurring_slots(bigint, integer, time, integer, integer, integer) to authenticated, service_role;
;
