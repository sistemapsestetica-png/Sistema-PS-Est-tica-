-- Completa a autorização master da recepção sem ampliar os GRANTs existentes.
-- private.is_receptionist() valida um perfil ativo da recepção e também preserva
-- compatibilidade com administradores da allowlist.

drop policy if exists services_admin_all on public.services;
create policy services_admin_all on public.services
for all to authenticated
using ((select private.is_receptionist()))
with check ((select private.is_receptionist()));

drop policy if exists slots_admin_all on public.slots;
create policy slots_admin_all on public.slots
for all to authenticated
using ((select private.is_receptionist()))
with check ((select private.is_receptionist()));

drop policy if exists bookings_admin_all on public.bookings;
create policy bookings_admin_all on public.bookings
for all to authenticated
using ((select private.is_receptionist()))
with check ((select private.is_receptionist()));

drop policy if exists leads_admin_all on public.leads;
create policy leads_admin_all on public.leads
for all to authenticated
using ((select private.is_receptionist()))
with check ((select private.is_receptionist()));

drop policy if exists payments_admin_all on public.payments;
create policy payments_admin_all on public.payments
for all to authenticated
using ((select private.is_receptionist()))
with check ((select private.is_receptionist()));

drop policy if exists clinic_settings_admin_all on public.clinic_settings;
create policy clinic_settings_admin_all on public.clinic_settings
for all to authenticated
using ((select private.is_receptionist()))
with check ((select private.is_receptionist()));
;
