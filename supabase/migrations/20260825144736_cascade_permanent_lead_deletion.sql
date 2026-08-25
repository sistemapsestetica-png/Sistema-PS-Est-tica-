-- Remove de forma atomica um lead arquivado e todos os registros operacionais
-- vinculados. Horarios futuros reservados voltam a ficar disponiveis.

create or replace function public.permanently_delete_lead(p_lead_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead_id bigint;
begin
  if not (select private.is_receptionist()) then
    raise exception 'Acesso não autorizado';
  end if;

  select l.id
    into v_lead_id
  from public.leads l
  where l.id = p_lead_id
    and l.archived_at is not null
  for update;

  if not found then
    raise exception 'Arquive o lead antes de excluí-lo permanentemente';
  end if;

  update public.slots s
  set status = 'open', updated_at = now()
  from public.bookings b
  where b.lead_id = v_lead_id
    and b.slot_id = s.id
    and s.starts_at > now()
    and s.status = 'reserved';

  delete from public.service_payments sp
  using public.bookings b
  where sp.booking_id = b.id
    and b.lead_id = v_lead_id;

  delete from public.payments p
  using public.bookings b
  where p.booking_id = b.id
    and b.lead_id = v_lead_id;

  delete from public.bookings b
  where b.lead_id = v_lead_id;

  delete from public.leads l
  where l.id = v_lead_id;
end;
$$;

revoke all on function public.permanently_delete_lead(bigint) from public, anon;
grant execute on function public.permanently_delete_lead(bigint) to authenticated;
