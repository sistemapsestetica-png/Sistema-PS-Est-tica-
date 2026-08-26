-- Reserva simples: R$ 50 fixos como crédito e preço final definido após avaliação.
alter table public.clinic_settings
  add column if not exists fixed_deposit_cents bigint not null default 5000;

alter table public.clinic_settings drop constraint if exists clinic_settings_fixed_deposit_check;
alter table public.clinic_settings add constraint clinic_settings_fixed_deposit_check
  check (fixed_deposit_cents > 0);

update public.clinic_settings set fixed_deposit_cents = 5000, updated_at = now() where id = true;

alter table public.bookings add column if not exists price_finalized boolean not null default true;
alter table public.bookings alter column price_cents drop not null;
alter table public.bookings drop constraint if exists bookings_deposit_check;
alter table public.bookings drop constraint if exists bookings_price_check;
alter table public.bookings add constraint bookings_deposit_check check (deposit_cents > 0);
alter table public.bookings add constraint bookings_price_check check (price_cents is null or price_cents > 0);

create or replace function private.calculate_booking_deposit(
  p_price_cents bigint,
  p_deposit_percent numeric,
  p_service_min_deposit_cents bigint
)
returns bigint
language sql stable security invoker set search_path = ''
as $$
  select coalesce(cs.fixed_deposit_cents, 5000)
  from public.clinic_settings cs where cs.id = true;
$$;

create or replace function public.list_open_slots(p_service_slug text)
returns table(slot_id bigint, service_slug text, service_name text, professional_id uuid, professional_name text, starts_at timestamptz, ends_at timestamptz, price_cents bigint, deposit_cents bigint)
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.release_expired_reservations();
  return query
  select sl.id, s.slug, s.name, sl.professional_id, coalesce(sp.full_name, 'Equipe PS Estética'),
         sl.starts_at, sl.ends_at, null::bigint,
         private.calculate_booking_deposit(s.price_cents, s.deposit_percent, s.min_deposit_cents)
  from public.slots sl join public.services s on s.id = sl.service_id
  left join public.staff_profiles sp on sp.user_id = sl.professional_id and sp.active
  where s.slug = p_service_slug and s.active
    and s.duration_minutes is not null and sl.status = 'open' and sl.starts_at > now()
    and not exists (select 1 from public.bookings b where b.slot_id = sl.id and b.status in ('pending','awaiting_payment','confirmed','rescheduled') and (b.status <> 'awaiting_payment' or b.payment_expires_at > now()))
  order by sl.starts_at limit 60;
end;
$$;

create or replace function public.reserve_slot_secure(p_lead_id bigint,p_reservation_token uuid,p_slot_id bigint)
returns table(booking_id bigint,booking_token uuid,booking_status text,service_name text,professional_name text,starts_at timestamptz,ends_at timestamptz,price_cents bigint,deposit_cents bigint,payment_expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_slot public.slots%rowtype; v_service public.services%rowtype; v_lead public.leads%rowtype;
        v_id bigint; v_token uuid; v_deposit bigint; v_exp integer; v_notice integer; v_prof_name text;
begin
  perform public.release_expired_reservations();
  select * into v_lead from public.leads where id=p_lead_id and reservation_token=p_reservation_token;
  if not found then raise exception 'Sessão de reserva inválida'; end if;
  select * into v_slot from public.slots where id=p_slot_id for update;
  if not found or v_slot.status<>'open' or v_slot.starts_at<=now() then raise exception 'Horário indisponível'; end if;
  select * into v_service from public.services where id=v_slot.service_id and active;
  if not found or v_service.slug<>v_lead.service_slug then raise exception 'Procedimento indisponível'; end if;
  select reservation_expiry_minutes,reschedule_notice_hours into v_exp,v_notice from public.clinic_settings where id=true;
  v_exp:=coalesce(v_exp,30); v_notice:=coalesce(v_notice,48);
  v_deposit:=private.calculate_booking_deposit(v_service.price_cents,v_service.deposit_percent,v_service.min_deposit_cents);
  v_token:=gen_random_uuid();
  update public.slots set status='reserved',updated_at=now() where id=p_slot_id;
  insert into public.bookings(lead_id,slot_id,service_id,professional_id,status,price_cents,price_finalized,deposit_cents,payment_expires_at,reschedule_deadline,public_token,booking_source)
  values(p_lead_id,p_slot_id,v_service.id,v_slot.professional_id,'awaiting_payment',null,false,v_deposit,now()+make_interval(mins=>v_exp),v_slot.starts_at-make_interval(hours=>v_notice),v_token,'quiz') returning id into v_id;
  update public.leads set status='scheduled',updated_at=now() where id=p_lead_id;
  select coalesce(full_name,'Equipe PS Estética') into v_prof_name from public.staff_profiles where user_id=v_slot.professional_id;
  return query select v_id,v_token,'awaiting_payment'::text,v_service.name,coalesce(v_prof_name,'Equipe PS Estética'),v_slot.starts_at,v_slot.ends_at,null::bigint,v_deposit,now()+make_interval(mins=>v_exp);
end;
$$;

create or replace function public.create_direct_booking(p_service_slug text,p_slot_id bigint,p_name text,p_phone text,p_email text default null,p_link_token uuid default null)
returns table(booking_id bigint,booking_token uuid,service_name text,professional_name text,starts_at timestamptz,deposit_cents bigint,payment_expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_slot public.slots%rowtype; v_service public.services%rowtype; v_lead_id bigint; v_booking_id bigint;
        v_booking_token uuid; v_phone text; v_name text; v_exp integer; v_notice integer; v_deposit bigint; v_prof_name text; v_link public.booking_links%rowtype;
begin
  perform public.release_expired_reservations();
  v_phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'); v_name:=btrim(coalesce(p_name,''));
  if char_length(v_name) not between 2 and 120 or v_phone !~ '^[0-9]{10,13}$' then raise exception 'Dados da cliente inválidos'; end if;
  if p_email is not null and p_email !~* '^[^@ ]+@[^@ ]+\.[^@ ]+$' then raise exception 'E-mail inválido'; end if;
  if p_link_token is not null then
    select * into v_link from public.booking_links where token=p_link_token and active and (expires_at is null or expires_at>now()) and (max_uses is null or uses<max_uses) for update;
    if not found then raise exception 'Link de agenda inválido ou expirado'; end if;
  end if;
  select * into v_slot from public.slots where id=p_slot_id for update;
  if not found or v_slot.status<>'open' or v_slot.starts_at<=now() then raise exception 'Horário indisponível'; end if;
  select * into v_service from public.services where id=v_slot.service_id and slug=p_service_slug and active;
  if not found then raise exception 'Procedimento indisponível'; end if;
  if p_link_token is not null and (v_link.service_id is not null and v_link.service_id<>v_service.id or v_link.professional_id is not null and v_link.professional_id is distinct from v_slot.professional_id) then raise exception 'Horário não pertence a este link'; end if;
  insert into public.leads(name,phone,email,service_slug,experience,timing,source,status)
  values(v_name,v_phone,lower(nullif(btrim(p_email),'')),v_service.slug,'primeira','semana',jsonb_build_object('channel','direct_schedule'),'scheduled') returning id into v_lead_id;
  select reservation_expiry_minutes,reschedule_notice_hours into v_exp,v_notice from public.clinic_settings where id=true;
  v_exp:=coalesce(v_exp,30); v_notice:=coalesce(v_notice,48); v_booking_token:=gen_random_uuid();
  v_deposit:=private.calculate_booking_deposit(v_service.price_cents,v_service.deposit_percent,v_service.min_deposit_cents);
  update public.slots set status='reserved',updated_at=now() where id=v_slot.id;
  insert into public.bookings(lead_id,slot_id,service_id,professional_id,status,price_cents,price_finalized,deposit_cents,payment_expires_at,reschedule_deadline,public_token,booking_source)
  values(v_lead_id,v_slot.id,v_service.id,v_slot.professional_id,'awaiting_payment',null,false,v_deposit,now()+make_interval(mins=>v_exp),v_slot.starts_at-make_interval(hours=>v_notice),v_booking_token,'direct') returning id into v_booking_id;
  if p_link_token is not null then update public.booking_links set uses=uses+1 where id=v_link.id; end if;
  select coalesce(full_name,'Equipe PS Estética') into v_prof_name from public.staff_profiles where user_id=v_slot.professional_id;
  return query select v_booking_id,v_booking_token,v_service.name,coalesce(v_prof_name,'Equipe PS Estética'),v_slot.starts_at,v_deposit,now()+make_interval(mins=>v_exp);
end;
$$;

create or replace function public.set_booking_final_price(p_booking_id bigint,p_price_cents bigint)
returns void language plpgsql security invoker set search_path = ''
as $$
declare v_paid bigint;
begin
  if not (select private.is_receptionist()) then raise exception 'Acesso não autorizado'; end if;
  if p_price_cents is null or p_price_cents <= 0 then raise exception 'Informe um valor final válido'; end if;
  perform 1 from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'Agendamento não encontrado'; end if;
  select coalesce(sum(amount_cents),0) into v_paid from (
    select amount_cents from public.payments where booking_id=p_booking_id and status='paid'
    union all select amount_cents from public.service_payments where booking_id=p_booking_id and status='paid'
  ) paid_values;
  if p_price_cents < v_paid then raise exception 'O valor final não pode ser menor que o total já pago'; end if;
  update public.bookings set price_cents=p_price_cents,price_finalized=true,updated_at=now() where id=p_booking_id;
end;
$$;

revoke all on function public.set_booking_final_price(bigint,bigint) from public,anon;
grant execute on function public.set_booking_final_price(bigint,bigint) to authenticated;
