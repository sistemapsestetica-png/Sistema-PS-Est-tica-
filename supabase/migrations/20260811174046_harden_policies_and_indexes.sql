
create index if not exists leads_service_slug_idx on public.leads (service_slug);

drop policy if exists services_public_read on public.services;
create policy services_public_read
on public.services for select
to anon
using (active);

drop policy if exists slots_public_read on public.slots;
create policy slots_public_read
on public.slots for select
to anon
using (status = 'open' and starts_at > now());

drop policy if exists admin_allowlist_self_read on public.admin_allowlist;
create policy admin_allowlist_self_read
on public.admin_allowlist for select
to authenticated
using (email = lower(coalesce((select auth.jwt() ->> 'email'), '')));

alter function public.list_open_slots(text) security invoker;

revoke execute on function public.capture_lead(text,text,text,text,text,jsonb) from authenticated;
revoke execute on function public.list_open_slots(text) from authenticated;
grant execute on function public.capture_lead(text,text,text,text,text,jsonb) to anon;
grant execute on function public.list_open_slots(text) to anon;

grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;
;
