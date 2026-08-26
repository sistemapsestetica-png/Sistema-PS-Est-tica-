-- Exclusão segura de horários avulsos ou em massa pela recepção.
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
    raise exception 'Apenas a recepção autorizada pode excluir horários.';
  end if;

  select coalesce(array_agg(distinct slot_id), '{}'::bigint[])
    into v_slot_ids
  from unnest(coalesce(p_slot_ids, '{}'::bigint[])) as selected(slot_id)
  where slot_id is not null;

  v_requested := cardinality(v_slot_ids);
  if v_requested = 0 then
    raise exception 'Selecione ao menos um horário.';
  end if;
  if v_requested > 500 then
    raise exception 'O limite é de 500 horários por operação.';
  end if;

  -- O bloqueio impede que uma reserva simultânea seja criada durante a exclusão.
  perform 1
  from public.slots sl
  where sl.id = any(v_slot_ids)
  for update;

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
