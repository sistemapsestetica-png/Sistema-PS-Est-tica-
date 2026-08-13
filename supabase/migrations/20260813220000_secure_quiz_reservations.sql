-- Vincula a reserva do quiz ao navegador que cadastrou o lead.
-- Mantém as funções antigas temporariamente para permitir publicação sem indisponibilidade.
alter table public.leads
  add column if not exists reservation_token uuid not null default gen_random_uuid();

create unique index if not exists leads_reservation_token_key
  on public.leads(reservation_token);

create or replace function public.capture_lead_session(
  p_name text,
  p_phone text,
  p_service_slug text,
  p_experience text,
  p_timing text,
  p_source jsonb default '{}'::jsonb,
  p_email text default null
)
returns table(lead_id bigint, reservation_token uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_name text := btrim(coalesce(p_name,''));
  v_id bigint;
  v_token uuid;
begin
  if char_length(v_name) not between 2 and 120 then raise exception 'Nome inválido'; end if;
  if v_phone !~ '^[0-9]{10,13}$' then raise exception 'WhatsApp inválido'; end if;
  if p_email is not null and p_email !~* '^[^@ ]+@[^@ ]+\.[^@ ]+$' then raise exception 'E-mail inválido'; end if;
  if p_experience not in ('primeira','ja_fiz') or p_timing not in ('semana','quinzena','pesquisando') then raise exception 'Respostas inválidas'; end if;
  if not exists(select 1 from public.services where slug=p_service_slug and active) then raise exception 'Serviço inválido'; end if;

  select id, leads.reservation_token into v_id, v_token
  from public.leads
  where phone=v_phone and service_slug=p_service_slug and created_at>now()-interval '10 minutes'
  order by created_at desc limit 1;

  if v_id is not null then
    update public.leads set
      name=v_name,
      email=coalesce(lower(nullif(btrim(p_email),'')),email),
      experience=p_experience,
      timing=p_timing,
      source=coalesce(p_source,source),
      updated_at=now()
    where id=v_id;
    return query select v_id,v_token;
    return;
  end if;

  insert into public.leads(name,phone,email,service_slug,experience,timing,source)
  values(v_name,v_phone,lower(nullif(btrim(p_email),'')),p_service_slug,p_experience,p_timing,coalesce(p_source,'{}'::jsonb))
  returning id, leads.reservation_token into v_id,v_token;
  return query select v_id,v_token;
end;
$$;

create or replace function public.reserve_slot_secure(
  p_lead_id bigint,
  p_reservation_token uuid,
  p_slot_id bigint
)
returns table(
  booking_id bigint, booking_token uuid, booking_status text,
  service_name text, professional_name text,
  starts_at timestamptz, ends_at timestamptz,
  price_cents bigint, deposit_cents bigint, payment_expires_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_slot public.slots%rowtype;
  v_service public.services%rowtype;
  v_lead public.leads%rowtype;
  v_id bigint; v_token uuid; v_deposit bigint;
  v_exp integer; v_notice integer; v_prof_name text;
begin
  perform public.release_expired_reservations();
  select * into v_lead from public.leads where id=p_lead_id and reservation_token=p_reservation_token;
  if not found then raise exception 'Sessão de reserva inválida'; end if;
  select * into v_slot from public.slots where id=p_slot_id for update;
  if not found or v_slot.status<>'open' or v_slot.starts_at<=now() then raise exception 'Horário indisponível'; end if;
  select * into v_service from public.services where id=v_slot.service_id and active;
  if not found or v_service.slug<>v_lead.service_slug or v_service.price_cents is null then raise exception 'Procedimento indisponível'; end if;
  select reservation_expiry_minutes,reschedule_notice_hours into v_exp,v_notice from public.clinic_settings where id=true;
  v_exp:=coalesce(v_exp,30); v_notice:=coalesce(v_notice,48);
  v_deposit:=greatest(ceil((v_service.price_cents*v_service.deposit_percent)::numeric/100)::bigint,v_service.min_deposit_cents);
  v_token:=gen_random_uuid();
  update public.slots set status='reserved',updated_at=now() where id=p_slot_id;
  insert into public.bookings(lead_id,slot_id,service_id,professional_id,status,price_cents,deposit_cents,payment_expires_at,reschedule_deadline,public_token,booking_source)
  values(p_lead_id,p_slot_id,v_service.id,v_slot.professional_id,'awaiting_payment',v_service.price_cents,v_deposit,now()+make_interval(mins=>v_exp),v_slot.starts_at-make_interval(hours=>v_notice),v_token,'quiz')
  returning id into v_id;
  update public.leads set status='scheduled',updated_at=now() where id=p_lead_id;
  select coalesce(full_name,'Equipe PS Estética') into v_prof_name from public.staff_profiles where user_id=v_slot.professional_id;
  return query select v_id,v_token,'awaiting_payment'::text,v_service.name,coalesce(v_prof_name,'Equipe PS Estética'),v_slot.starts_at,v_slot.ends_at,v_service.price_cents,v_deposit,now()+make_interval(mins=>v_exp);
end;
$$;

revoke all on function public.capture_lead_session(text,text,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.reserve_slot_secure(bigint,uuid,bigint) from public,anon,authenticated;
grant execute on function public.capture_lead_session(text,text,text,text,text,jsonb,text) to anon,authenticated;
grant execute on function public.reserve_slot_secure(bigint,uuid,bigint) to anon,authenticated;

