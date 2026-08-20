-- Livro-caixa do saldo dos procedimentos. O sinal continua na tabela payments.

create table if not exists public.service_payments (
  id bigint generated always as identity primary key,
  booking_id bigint not null references public.bookings(id) on delete restrict,
  payment_type text not null default 'balance' check (payment_type in ('balance','full','adjustment')),
  method text not null check (method in ('mercado_pago','cash','card_machine','pix_manual','transfer','other')),
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled','refunded')),
  amount_cents bigint not null check (amount_cents > 0),
  provider_external_id text,
  provider_preference_id text,
  checkout_url text,
  notes text,
  paid_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_payments_provider_external_key
  on public.service_payments(provider_external_id)
  where provider_external_id is not null;
create index if not exists service_payments_booking_idx on public.service_payments(booking_id);
create index if not exists service_payments_paid_at_idx on public.service_payments(paid_at desc) where status = 'paid';

alter table public.service_payments enable row level security;

drop policy if exists service_payments_reception_all on public.service_payments;
create policy service_payments_reception_all on public.service_payments for all to authenticated
using ((select private.is_receptionist()))
with check ((select private.is_receptionist()));

grant select, insert, update on public.service_payments to authenticated;
grant usage, select on sequence public.service_payments_id_seq to authenticated;
