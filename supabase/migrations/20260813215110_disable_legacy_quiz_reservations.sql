-- Executar depois que o frontend seguro estiver publicado.
revoke execute on function public.capture_lead(text,text,text,text,text,jsonb,text) from anon,authenticated;
revoke execute on function public.reserve_slot(bigint,bigint) from anon,authenticated;
;
