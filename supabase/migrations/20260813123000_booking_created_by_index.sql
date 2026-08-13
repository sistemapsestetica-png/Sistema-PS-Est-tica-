-- Índice da chave de auditoria usada em reservas criadas pela equipe.
create index if not exists bookings_created_by_idx on public.bookings(created_by);
