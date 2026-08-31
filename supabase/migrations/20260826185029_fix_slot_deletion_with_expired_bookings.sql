-- Permite apagar horarios livres que possuem apenas tentativas de reserva
-- expiradas/canceladas e sem pagamento, preservando o historico da tentativa.
alter table public.bookings
  alter column slot_id drop not null;
alter table public.bookings
  drop constraint if exists bookings_slot_id_fkey;
alter table public.bookings
  add constraint bookings_slot_id_fkey
  foreign key (slot_id) references public.slots(id) on delete set null;
create or replace function public.delete_available_slots(p_slot_ids bigint[])
returns table(requested_count integer, deleted_count integer, protected_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slot_ids bigint[];
  v_requested integer;
  v_deleted integer;
begin
  if not (select private.is_receptionist()) then
    raise exception 'Apenas a recepcao autorizada pode excluir horarios.';
  end if;

  select coalesce(array_agg(distinct slot_id), '{}'::bigint[])
    into v_slot_ids
  from unnest(coalesce(p_slot_ids, '{}'::bigint[])) as selected(slot_id)
  where slot_id is not null;

  v_requested := cardinality(v_slot_ids);
  if v_requested = 0 then
    raise exception 'Selecione ao menos um horario.';
  end if;
  if v_requested > 500 then
    raise exception 'O limite e de 500 horarios por operacao.';
  end if;

  perform 1
  from public.slots sl
  where sl.id = any(v_slot_ids)
  for update;

  -- Uma tentativa expirada nao deve impedir a remocao do horario. O booking
  -- permanece no historico, mas perde apenas o vinculo com o horario apagado.
  update public.bookings b
  set slot_id = null,
      updated_at = now()
  where b.slot_id = any(v_slot_ids)
    and b.status in ('expired', 'cancelled')
    and exists (
      select 1
      from public.slots sl
      where sl.id = b.slot_id
        and sl.status in ('open', 'blocked')
    )
    and not exists (
      select 1
      from public.payments p
      where p.booking_id = b.id
        and p.status = 'paid'
    )
    and not exists (
      select 1
      from public.service_payments sp
      where sp.booking_id = b.id
        and sp.status = 'paid'
    );

  with deleted as (
    delete from public.slots sl
    where sl.id = any(v_slot_ids)
      and sl.status in ('open', 'blocked')
      and not exists (
        select 1 from public.bookings b where b.slot_id = sl.id
      )
    returning sl.id
  )
  select count(*)::integer into v_deleted from deleted;

  return query select v_requested, v_deleted, v_requested - v_deleted;
end;
$$;
revoke all on function public.delete_available_slots(bigint[]) from public, anon;
grant execute on function public.delete_available_slots(bigint[]) to authenticated;
-- A agenda passa a ser criada somente de forma manual.
revoke all on function public.create_recurring_slots(bigint, integer, time, integer, integer, integer, uuid)
  from public, anon, authenticated;
