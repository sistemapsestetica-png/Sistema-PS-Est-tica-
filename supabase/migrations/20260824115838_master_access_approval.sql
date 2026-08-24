-- Aprovação segura de recepcionistas pelo usuário master.

alter table public.staff_profiles
  add column if not exists is_master boolean not null default false;

create table if not exists public.staff_access_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique check (email = lower(email)),
  full_name text not null check (char_length(full_name) between 2 and 120),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_access_requests_status_created_idx
  on public.staff_access_requests(status, created_at desc);

alter table public.staff_access_requests enable row level security;
grant select on public.staff_access_requests to authenticated;

create or replace function private.is_master()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and sp.active
      and sp.is_master
  );
$$;

revoke all on function private.is_master() from public, anon, authenticated;
grant execute on function private.is_master() to authenticated;

update public.staff_profiles sp
set is_master = true, active = true, role = 'receptionist', updated_at = now()
from public.admin_allowlist a
where a.email = sp.email and a.active;

create or replace function public.queue_staff_access_request()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email is null or new.email_confirmed_at is null or exists (select 1 from public.staff_profiles sp where sp.user_id = new.id) then
    return new;
  end if;

  insert into public.staff_access_requests(user_id,email,full_name,status,updated_at)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''), split_part(new.email,'@',1)),
    'pending',
    now()
  )
  on conflict (user_id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    status = case when public.staff_access_requests.status = 'approved' then 'approved' else 'pending' end,
    updated_at = now();
  return new;
end;
$$;

revoke all on function public.queue_staff_access_request() from public, anon, authenticated;

drop trigger if exists on_auth_user_access_request on auth.users;
create trigger on_auth_user_access_request
after insert or update of email, email_confirmed_at on auth.users
for each row execute function public.queue_staff_access_request();

insert into public.staff_access_requests(user_id,email,full_name,status)
select
  u.id,
  lower(u.email),
  coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''), split_part(u.email,'@',1)),
  'pending'
from auth.users u
left join public.staff_profiles sp on sp.user_id = u.id
where u.email is not null and u.email_confirmed_at is not null and sp.user_id is null
on conflict (user_id) do nothing;

delete from public.staff_access_requests r
using auth.users u
where u.id = r.user_id and u.email_confirmed_at is null and r.status = 'pending';

create or replace function public.review_staff_access_request(p_request_id bigint, p_approve boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_request public.staff_access_requests%rowtype;
begin
  if not (select private.is_master()) then
    raise exception 'Somente o usuário master pode autorizar recepcionistas.';
  end if;

  select * into v_request
  from public.staff_access_requests
  where id = p_request_id and status = 'pending'
  for update;

  if not found then
    raise exception 'Solicitação pendente não encontrada.';
  end if;

  if p_approve then
    insert into public.staff_profiles(user_id,full_name,email,role,active,is_master,updated_at)
    values(v_request.user_id,v_request.full_name,v_request.email,'receptionist',true,false,now())
    on conflict(user_id) do update set
      full_name=excluded.full_name,
      email=excluded.email,
      role='receptionist',
      active=true,
      is_master=false,
      updated_at=now();
  end if;

  update public.staff_access_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()), reviewed_at = now(), updated_at = now()
  where id = p_request_id;
end;
$$;

revoke all on function public.review_staff_access_request(bigint,boolean) from public, anon;
grant execute on function public.review_staff_access_request(bigint,boolean) to authenticated;

drop policy if exists staff_access_requests_self_read on public.staff_access_requests;
create policy staff_access_requests_self_read on public.staff_access_requests
for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_master()));

drop policy if exists staff_profiles_reception_all on public.staff_profiles;
drop policy if exists staff_profiles_master_update on public.staff_profiles;
create policy staff_profiles_master_update on public.staff_profiles
for update to authenticated
using ((select private.is_master()))
with check ((select private.is_master()));

drop policy if exists staff_profiles_reception_professional_update on public.staff_profiles;
create policy staff_profiles_reception_professional_update on public.staff_profiles
for update to authenticated
using ((select private.is_receptionist()) and role = 'professional' and not is_master)
with check (role = 'professional' and not is_master);

drop policy if exists staff_invites_reception_all on public.staff_invites;
drop policy if exists staff_invites_master_all on public.staff_invites;
create policy staff_invites_master_all on public.staff_invites
for all to authenticated
using ((select private.is_master()))
with check ((select private.is_master()));

drop policy if exists staff_invites_reception_professional_all on public.staff_invites;
create policy staff_invites_reception_professional_all on public.staff_invites
for all to authenticated
using ((select private.is_receptionist()) and role = 'professional')
with check (role = 'professional');
