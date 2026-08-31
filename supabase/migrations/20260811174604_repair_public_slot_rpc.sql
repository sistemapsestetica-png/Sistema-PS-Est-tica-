
alter function public.list_open_slots(text) security definer;
revoke execute on function public.list_open_slots(text) from authenticated;
grant execute on function public.list_open_slots(text) to anon;

drop policy if exists admin_allowlist_self_read on public.admin_allowlist;
create policy admin_allowlist_self_read
on public.admin_allowlist for select
to authenticated
using (email = (select lower(auth.jwt() ->> 'email')));
;
