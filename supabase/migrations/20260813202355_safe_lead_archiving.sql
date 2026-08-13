alter table public.leads add column if not exists archived_at timestamptz;

create index if not exists leads_archived_created_idx on public.leads (archived_at, created_at desc);

create or replace function public.permanently_delete_lead(p_lead_id bigint)
returns void language plpgsql security invoker set search_path = public, private as $$
begin
  if not private.is_receptionist() then raise exception 'Acesso não autorizado'; end if;
  if exists (select 1 from public.bookings where lead_id = p_lead_id) then
    raise exception 'Este lead possui agendamentos e não pode ser excluído permanentemente';
  end if;
  delete from public.leads where id = p_lead_id and archived_at is not null;
  if not found then raise exception 'Arquive o lead antes de excluí-lo permanentemente'; end if;
end;
$$;

revoke all on function public.permanently_delete_lead(bigint) from public, anon;
grant execute on function public.permanently_delete_lead(bigint) to authenticated;
