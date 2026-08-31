-- CRM operacional e expiração automática das pré-reservas.

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('new','contacted','qualified','scheduled','attended','no_answer','lost'));
create or replace function public.release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.bookings b
    set status = 'expired', updated_at = now()
    where b.status = 'awaiting_payment'
      and b.payment_expires_at <= now()
    returning b.slot_id
  )
  update public.slots s
  set status = 'open', updated_at = now()
  where s.id in (select slot_id from expired)
    and not exists (
      select 1
      from public.bookings b
      where b.slot_id = s.id
        and (
          b.status in ('confirmed','pending','rescheduled')
          or (b.status = 'awaiting_payment' and b.payment_expires_at > now())
        )
    );

  get diagnostics v_count = row_count;

  update public.payments p
  set status = 'expired', updated_at = now()
  where p.status in ('awaiting_provider','pending')
    and p.expires_at <= now();

  return v_count;
end;
$$;
revoke all on function public.release_expired_reservations() from public, anon, authenticated;
create or replace function private.require_paid_booking_confirmation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'confirmed'
     and old.status is distinct from 'confirmed'
     and not exists (
       select 1 from public.payments p
       where p.booking_id = new.id and p.status = 'paid'
     ) then
    raise exception 'O agendamento só pode ser confirmado após o pagamento do sinal.';
  end if;
  return new;
end;
$$;
revoke all on function private.require_paid_booking_confirmation() from public, anon, authenticated;
drop trigger if exists require_paid_booking_confirmation on public.bookings;
create trigger require_paid_booking_confirmation
before update of status on public.bookings
for each row execute function private.require_paid_booking_confirmation();
create extension if not exists pg_cron;
select cron.schedule(
  'release-expired-prebookings',
  '* * * * *',
  'select public.release_expired_reservations()'
);
