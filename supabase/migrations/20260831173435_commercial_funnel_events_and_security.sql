-- Funil comercial, eventos internos e endurecimento da sessao publica do quiz.
-- Esta migration e incremental e preserva integralmente os registros existentes.

do $$
begin
  if exists (
    select 1 from public.leads
    where status not in ('new','contacted','qualified','scheduled','attended','no_answer','lost')
  ) then
    raise exception 'Existem status de lead inesperados. Revise os dados antes de aplicar esta migration.';
  end if;
end
$$;

alter table public.leads add column if not exists city text;
alter table public.leads add column if not exists intent_level text;
alter table public.leads add column if not exists next_action text;
alter table public.leads add column if not exists next_action_at timestamptz;

alter table public.leads drop constraint if exists leads_city_length_check;
alter table public.leads add constraint leads_city_length_check
  check (city is null or char_length(city) between 2 and 120);

alter table public.leads drop constraint if exists leads_intent_level_check;
alter table public.leads add constraint leads_intent_level_check
  check (intent_level is null or intent_level in ('high','medium','low'));

alter table public.leads drop constraint if exists leads_next_action_length_check;
alter table public.leads add constraint leads_next_action_length_check
  check (next_action is null or char_length(next_action) <= 500);

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in (
    'new','contacted','qualified','scheduled','attended','no_answer','lost',
    'replied','interested','slots_viewed','booking_started','awaiting_payment','converted'
  ));

create or replace function private.commercial_intent_from_timing(p_timing text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_timing
    when 'semana' then 'high'
    when 'quinzena' then 'medium'
    when 'pesquisando' then 'low'
    else null
  end;
$$;

revoke all on function private.commercial_intent_from_timing(text) from public, anon, authenticated;

update public.leads
set intent_level = private.commercial_intent_from_timing(timing)
where intent_level is null;

create or replace function private.set_lead_commercial_intent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.intent_level is null or new.timing is distinct from old.timing then
    new.intent_level := private.commercial_intent_from_timing(new.timing);
  end if;
  return new;
end;
$$;

revoke all on function private.set_lead_commercial_intent() from public, anon, authenticated;

drop trigger if exists set_lead_commercial_intent_before_write on public.leads;
create trigger set_lead_commercial_intent_before_write
before insert or update of timing, intent_level on public.leads
for each row execute function private.set_lead_commercial_intent();

create table if not exists public.lead_events (
  id bigint generated always as identity primary key,
  lead_id bigint not null references public.leads(id) on delete cascade,
  event_type text not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  booking_id bigint references public.bookings(id) on delete set null,
  constraint lead_events_type_check check (event_type in (
    'page_view','quiz_started','quiz_completed','lead_created','lead_qualified',
    'whatsapp_opened','lead_contacted','lead_replied','interested','lead_lost',
    'slots_viewed','booking_started','booking_completed','booking_cancelled',
    'appointment_completed','no_show','payment_pending','payment_confirmed'
  )),
  constraint lead_events_metadata_size_check check (pg_column_size(metadata) <= 16384)
);

create index if not exists lead_events_lead_created_idx
  on public.lead_events(lead_id, created_at desc);
create index if not exists lead_events_type_created_idx
  on public.lead_events(event_type, created_at desc);
create index if not exists lead_events_booking_idx
  on public.lead_events(booking_id) where booking_id is not null;
create unique index if not exists lead_events_single_lead_milestone_idx
  on public.lead_events(lead_id, event_type)
  where event_type in ('lead_created','quiz_completed','lead_qualified');

create index if not exists leads_city_created_idx on public.leads(city, created_at desc);
create index if not exists leads_intent_created_idx on public.leads(intent_level, created_at desc);
create index if not exists leads_next_action_due_idx
  on public.leads(next_action_at) where next_action_at is not null;

alter table public.lead_events enable row level security;
revoke all on table public.lead_events from public, anon, authenticated;
grant select on table public.lead_events to authenticated;

drop policy if exists lead_events_reception_read on public.lead_events;
create policy lead_events_reception_read
on public.lead_events for select to authenticated
using ((select private.is_receptionist()));

drop policy if exists lead_events_professional_read on public.lead_events;
create policy lead_events_professional_read
on public.lead_events for select to authenticated
using (
  exists (
    select 1
    from public.bookings b
    where b.lead_id = lead_events.lead_id
      and b.professional_id = (select auth.uid())
  )
);

create or replace function private.append_lead_event(
  p_lead_id bigint,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb,
  p_booking_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id bigint;
begin
  if p_event_type in ('lead_created','quiz_completed','lead_qualified') then
    insert into public.lead_events(lead_id,event_type,metadata,booking_id)
    values(p_lead_id,p_event_type,coalesce(p_metadata,'{}'::jsonb),p_booking_id)
    on conflict (lead_id,event_type)
      where event_type in ('lead_created','quiz_completed','lead_qualified')
      do nothing
    returning id into v_event_id;
    return v_event_id;
  end if;

  insert into public.lead_events(lead_id,event_type,metadata,booking_id)
  values(p_lead_id,p_event_type,coalesce(p_metadata,'{}'::jsonb),p_booking_id)
  returning id into v_event_id;
  return v_event_id;
end;
$$;

revoke all on function private.append_lead_event(bigint,text,jsonb,bigint) from public, anon, authenticated;

create or replace function private.track_new_lead_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.append_lead_event(
    new.id,
    'lead_created',
    jsonb_build_object('service_slug',new.service_slug,'source',coalesce(new.source,'{}'::jsonb))
  );
  return new;
end;
$$;

revoke all on function private.track_new_lead_event() from public, anon, authenticated;
drop trigger if exists track_new_lead_event_after_insert on public.leads;
create trigger track_new_lead_event_after_insert
after insert on public.leads
for each row execute function private.track_new_lead_event();

create or replace function private.track_lead_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_event_type := case new.status
    when 'contacted' then 'lead_contacted'
    when 'replied' then 'lead_replied'
    when 'interested' then 'interested'
    when 'lost' then 'lead_lost'
    when 'slots_viewed' then 'slots_viewed'
    when 'booking_started' then 'booking_started'
    else null
  end;
  if v_event_type is not null then
    perform private.append_lead_event(new.id,v_event_type,jsonb_build_object('previous_status',old.status));
  end if;
  return new;
end;
$$;

revoke all on function private.track_lead_status_event() from public, anon, authenticated;
drop trigger if exists track_lead_status_event_after_update on public.leads;
create trigger track_lead_status_event_after_update
after update of status on public.leads
for each row execute function private.track_lead_status_event();

create or replace function private.track_booking_funnel_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    if new.booking_source = 'direct' then
      perform private.append_lead_event(
        new.lead_id,
        'booking_started',
        jsonb_build_object('automated',true,'booking_source','direct'),
        new.id
      );
    end if;
    perform private.append_lead_event(new.lead_id,'booking_completed','{}'::jsonb,new.id);
    return new;
  end if;

  if new.status is not distinct from old.status then return new; end if;
  v_event_type := case new.status
    when 'cancelled' then 'booking_cancelled'
    when 'expired' then 'booking_cancelled'
    when 'completed' then 'appointment_completed'
    when 'no_show' then 'no_show'
    else null
  end;
  if v_event_type is not null then
    perform private.append_lead_event(
      new.lead_id,
      v_event_type,
      jsonb_build_object('booking_status',new.status,'previous_status',old.status),
      new.id
    );
  end if;
  return new;
end;
$$;

revoke all on function private.track_booking_funnel_event() from public, anon, authenticated;
drop trigger if exists track_booking_funnel_event_after_write on public.bookings;
create trigger track_booking_funnel_event_after_write
after insert or update of status on public.bookings
for each row execute function private.track_booking_funnel_event();

-- Compatibilidade segura para paginas ainda nao migradas: nao reutiliza lead ou token por telefone.
create or replace function public.capture_lead_session(
  p_name text,
  p_phone text,
  p_service_slug text,
  p_experience text,
  p_timing text,
  p_source jsonb default '{}'::jsonb,
  p_email text default null
)
returns table(lead_id bigint,reservation_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_name text := btrim(coalesce(p_name,''));
  v_id bigint;
  v_token uuid;
begin
  if char_length(v_name) not between 2 and 120 then raise exception 'Nome invalido'; end if;
  if not private.is_valid_brazilian_whatsapp(v_phone) then raise exception 'WhatsApp invalido'; end if;
  if p_email is not null and p_email !~* '^[^@ ]+@[^@ ]+\.[^@ ]+$' then raise exception 'E-mail invalido'; end if;
  if p_experience not in ('primeira','ja_fiz') or p_timing not in ('semana','quinzena','pesquisando') then raise exception 'Respostas invalidas'; end if;
  if pg_column_size(coalesce(p_source,'{}'::jsonb)) > 16384 then raise exception 'Origem invalida'; end if;
  if not exists(select 1 from public.services where slug=p_service_slug and active) then raise exception 'Servico invalido'; end if;

  v_token := gen_random_uuid();
  insert into public.leads(name,phone,email,service_slug,experience,timing,source,status,reservation_token)
  values(v_name,v_phone,lower(nullif(btrim(p_email),'')),p_service_slug,p_experience,p_timing,coalesce(p_source,'{}'::jsonb),'qualified',v_token)
  returning id into v_id;

  perform private.append_lead_event(v_id,'quiz_completed');
  perform private.append_lead_event(v_id,'lead_qualified');
  return query select v_id,v_token;
end;
$$;

revoke all on function public.capture_lead_session(text,text,text,text,text,jsonb,text) from public;
grant execute on function public.capture_lead_session(text,text,text,text,text,jsonb,text) to anon, authenticated, service_role;

create or replace function public.capture_lead_session_v2(
  p_session_token uuid,
  p_name text,
  p_phone text,
  p_service_slug text,
  p_experience text,
  p_timing text,
  p_city text,
  p_source jsonb default '{}'::jsonb,
  p_email text default null
)
returns table(lead_id bigint,reservation_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_name text := btrim(coalesce(p_name,''));
  v_city text := nullif(btrim(coalesce(p_city,'')),'');
  v_id bigint;
begin
  if p_session_token is null then raise exception 'Sessao invalida'; end if;
  if char_length(v_name) not between 2 and 120 then raise exception 'Nome invalido'; end if;
  if not private.is_valid_brazilian_whatsapp(v_phone) then raise exception 'WhatsApp invalido'; end if;
  if p_email is not null and p_email !~* '^[^@ ]+@[^@ ]+\.[^@ ]+$' then raise exception 'E-mail invalido'; end if;
  if p_experience not in ('primeira','ja_fiz') or p_timing not in ('semana','quinzena','pesquisando') then raise exception 'Respostas invalidas'; end if;
  if v_city is null or char_length(v_city) not between 2 and 120 then raise exception 'Cidade invalida'; end if;
  if pg_column_size(coalesce(p_source,'{}'::jsonb)) > 16384 then raise exception 'Origem invalida'; end if;
  if not exists(select 1 from public.services where slug=p_service_slug and active) then raise exception 'Servico invalido'; end if;

  -- Serializa reenvios simultaneos da mesma sessao sem usar telefone como chave.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_token::text,0));

  select l.id into v_id
  from public.leads as l
  where l.reservation_token=p_session_token and l.service_slug=p_service_slug
  for update;

  if v_id is null then
    insert into public.leads(name,phone,email,service_slug,experience,timing,city,source,status,reservation_token)
    values(v_name,v_phone,lower(nullif(btrim(p_email),'')),p_service_slug,p_experience,p_timing,v_city,coalesce(p_source,'{}'::jsonb),'qualified',p_session_token)
    returning id into v_id;
  else
    update public.leads set
      name=v_name,
      phone=v_phone,
      email=coalesce(lower(nullif(btrim(p_email),'')),email),
      experience=p_experience,
      timing=p_timing,
      city=v_city,
      source=coalesce(p_source,source),
      updated_at=now()
    where id=v_id;
  end if;

  perform private.append_lead_event(v_id,'quiz_completed');
  perform private.append_lead_event(v_id,'lead_qualified');
  return query select v_id,p_session_token;
end;
$$;

revoke all on function public.capture_lead_session_v2(uuid,text,text,text,text,text,text,jsonb,text) from public;
grant execute on function public.capture_lead_session_v2(uuid,text,text,text,text,text,text,jsonb,text) to anon, authenticated, service_role;

create or replace function public.record_lead_event(
  p_lead_id bigint,
  p_reservation_token uuid,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb,
  p_booking_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id bigint;
  v_current_status text;
  v_next_status text;
  v_status_changed boolean := false;
begin
  if p_event_type not in ('quiz_completed','whatsapp_opened','slots_viewed','booking_started') then
    raise exception 'Evento publico nao permitido';
  end if;
  if pg_column_size(coalesce(p_metadata,'{}'::jsonb)) > 16384 then raise exception 'Metadados invalidos'; end if;

  select status into v_current_status
  from public.leads
  where id=p_lead_id and reservation_token=p_reservation_token
  for update;
  if not found then raise exception 'Sessao de lead invalida'; end if;

  if p_booking_id is not null and not exists(
    select 1 from public.bookings where id=p_booking_id and lead_id=p_lead_id
  ) then raise exception 'Reserva invalida'; end if;

  v_next_status := case p_event_type
    when 'slots_viewed' then 'slots_viewed'
    when 'booking_started' then 'booking_started'
    else null
  end;
  if v_next_status is not null
     and v_current_status is distinct from v_next_status
     and v_current_status not in ('scheduled','awaiting_payment','converted','attended','lost') then
    update public.leads set status=v_next_status,updated_at=now() where id=p_lead_id;
    v_status_changed := true;
  end if;

  if v_status_changed then
    select id into v_event_id
    from public.lead_events
    where lead_id=p_lead_id and event_type=p_event_type
    order by created_at desc,id desc
    limit 1;
    return v_event_id;
  end if;

  v_event_id := private.append_lead_event(p_lead_id,p_event_type,coalesce(p_metadata,'{}'::jsonb),p_booking_id);
  return v_event_id;
end;
$$;

revoke all on function public.record_lead_event(bigint,uuid,text,jsonb,bigint) from public;
grant execute on function public.record_lead_event(bigint,uuid,text,jsonb,bigint) to anon, authenticated, service_role;

create or replace function public.set_lead_commercial_status(p_lead_id bigint,p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_receptionist()) then raise exception 'Acesso nao autorizado'; end if;
  if p_status not in ('contacted','replied','interested','lost') then raise exception 'Status comercial invalido'; end if;
  update public.leads set status=p_status,updated_at=now() where id=p_lead_id;
  if not found then raise exception 'Lead nao encontrado'; end if;
end;
$$;

revoke all on function public.set_lead_commercial_status(bigint,text) from public, anon;
grant execute on function public.set_lead_commercial_status(bigint,text) to authenticated;

create or replace function public.set_lead_follow_up(
  p_lead_id bigint,
  p_next_action text,
  p_next_action_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := nullif(btrim(coalesce(p_next_action,'')),'');
begin
  if not (select private.is_receptionist()) then raise exception 'Acesso nao autorizado'; end if;
  if v_action is not null and char_length(v_action) > 500 then raise exception 'Proxima acao muito longa'; end if;
  update public.leads
  set next_action=v_action,next_action_at=case when v_action is null then null else p_next_action_at end,updated_at=now()
  where id=p_lead_id;
  if not found then raise exception 'Lead nao encontrado'; end if;
end;
$$;

revoke all on function public.set_lead_follow_up(bigint,text,timestamptz) from public, anon;
grant execute on function public.set_lead_follow_up(bigint,text,timestamptz) to authenticated;
