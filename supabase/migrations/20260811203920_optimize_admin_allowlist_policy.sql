
    drop policy if exists admin_allowlist_self_read on public.admin_allowlist;
    create policy admin_allowlist_self_read
    on public.admin_allowlist
    for select
    to authenticated
    using (email = lower(coalesce(((select auth.jwt()) ->> 'email'), '')));
  ;
