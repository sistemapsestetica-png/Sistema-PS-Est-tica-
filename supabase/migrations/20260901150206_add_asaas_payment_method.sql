alter table public.service_payments
  drop constraint if exists service_payments_method_check;

alter table public.service_payments
  add constraint service_payments_method_check
  check (method in ('asaas', 'mercado_pago', 'cash', 'card_machine', 'pix_manual', 'transfer', 'other'));
