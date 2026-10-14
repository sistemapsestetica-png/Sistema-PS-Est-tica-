alter table public.lead_events
  drop constraint if exists lead_events_type_check;

alter table public.lead_events
  add constraint lead_events_type_check check (event_type in (
    'page_view','quiz_started','quiz_completed','lead_created','lead_qualified',
    'whatsapp_opened','lead_contacted','lead_replied','interested','lead_lost',
    'slots_viewed','booking_started','booking_completed','booking_cancelled',
    'appointment_completed','no_show','payment_pending','payment_confirmed',
    'lead_note_updated'
  ));

create or replace function public.set_lead_notes(
  p_lead_id bigint,
  p_notes text
)
returns table(notes text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_updated_at timestamptz;
begin
  if not (select private.is_receptionist()) then
    raise exception 'Acesso nao autorizado';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'Observacao muito longa';
  end if;

  update public.leads as l
  set notes = v_notes,
      updated_at = now()
  where l.id = p_lead_id
  returning l.notes, l.updated_at into v_notes, v_updated_at;

  if not found then
    raise exception 'Lead nao encontrado';
  end if;

  perform private.append_lead_event(
    p_lead_id,
    'lead_note_updated',
    jsonb_build_object('has_note', v_notes is not null, 'note_length', coalesce(char_length(v_notes), 0))
  );

  return query select v_notes, v_updated_at;
end;
$$;

revoke all on function public.set_lead_notes(bigint,text) from public, anon;
grant execute on function public.set_lead_notes(bigint,text) to authenticated;
