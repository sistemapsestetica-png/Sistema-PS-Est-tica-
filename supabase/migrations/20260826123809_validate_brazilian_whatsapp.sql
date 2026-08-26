create or replace function private.is_valid_brazilian_whatsapp(p_phone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') ~
    '^(11|12|13|14|15|16|17|18|19|21|22|24|27|28|31|32|33|34|35|37|38|41|42|43|44|45|46|47|48|49|51|53|54|55|61|62|63|64|65|66|67|68|69|71|73|74|75|77|79|81|82|83|84|85|86|87|88|89|91|92|93|94|95|96|97|98|99)9[0-9]{8}$';
$$;

revoke all on function private.is_valid_brazilian_whatsapp(text) from public, anon, authenticated;

create or replace function private.validate_lead_whatsapp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.phone := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');

  if not private.is_valid_brazilian_whatsapp(new.phone) then
    raise exception 'WhatsApp inválido. Informe um celular com DDD e 9 dígitos, por exemplo: (11) 90000-0000.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_lead_whatsapp() from public, anon, authenticated;

drop trigger if exists validate_lead_whatsapp_before_write on public.leads;
create trigger validate_lead_whatsapp_before_write
before insert or update of phone on public.leads
for each row execute function private.validate_lead_whatsapp();
