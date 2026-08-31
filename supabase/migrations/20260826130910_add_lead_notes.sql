alter table public.leads add column if not exists notes text;

alter table public.leads drop constraint if exists leads_notes_length_check;
alter table public.leads add constraint leads_notes_length_check
  check (notes is null or char_length(notes) <= 2000);;
