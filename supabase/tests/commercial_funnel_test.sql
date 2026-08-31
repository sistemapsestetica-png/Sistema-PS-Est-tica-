begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, pg_catalog;
select plan(38);

select has_table('public','lead_events','lead_events existe');
select has_column('public','leads','city','leads.city existe');
select has_column('public','leads','intent_level','leads.intent_level existe');
select has_column('public','leads','next_action','leads.next_action existe');
select has_column('public','leads','next_action_at','leads.next_action_at existe');
select col_is_null('public','leads','city','city permanece opcional para registros antigos');
select ok((select relrowsecurity from pg_class where oid='public.lead_events'::regclass),'RLS ativa em lead_events');
select ok(not has_table_privilege('anon','public.leads','SELECT'),'anon nao recebe SELECT direto em leads');
select ok(not has_table_privilege('anon','public.lead_events','SELECT'),'anon nao recebe SELECT direto em lead_events');
select ok(not has_table_privilege('anon','public.lead_events','INSERT'),'anon nao recebe INSERT direto em lead_events');
select ok(has_function_privilege('anon','public.capture_lead_session_v2(uuid,text,text,text,text,text,text,jsonb,text)','EXECUTE'),'anon pode executar capture_lead_session_v2');
select ok(has_function_privilege('anon','public.record_lead_event(bigint,uuid,text,jsonb,bigint)','EXECUTE'),'anon pode executar record_lead_event validada');

insert into public.leads(name,phone,email,service_slug,experience,timing,source,status) values
('Lead Semana','11911111111','semana@example.test','lavieen','primeira','semana','{"utm_source":"fixture"}','new'),
('Lead Quinzena','11922222222','quinzena@example.test','lavieen','primeira','quinzena','{"utm_source":"fixture"}','contacted'),
('Lead Pesquisa','11933333333','pesquisa@example.test','lavieen','ja_fiz','pesquisando','{"utm_source":"fixture"}','qualified');
select is((select intent_level from public.leads where email='semana@example.test'),'high','semana mapeia para high');
select is((select intent_level from public.leads where email='quinzena@example.test'),'medium','quinzena mapeia para medium');
select is((select intent_level from public.leads where email='pesquisa@example.test'),'low','pesquisando mapeia para low');
select is((select source->>'utm_source' from public.leads where email='semana@example.test'),'fixture','source JSONB e preservado');
select is((select count(*) from public.leads where email in ('semana@example.test','quinzena@example.test','pesquisa@example.test'))::bigint,3::bigint,'leads existentes permanecem presentes');

select lives_ok($sql$select * from public.capture_lead_session_v2('11111111-1111-4111-8111-111111111111','Sessao A','11944444444','lavieen','primeira','semana','Sao Bernardo do Campo','{"utm_source":"session-a"}','a@example.test')$sql$,'sessao A cria lead');
select lives_ok($sql$select * from public.capture_lead_session_v2('22222222-2222-4222-8222-222222222222','Sessao B','11944444444','lavieen','primeira','semana','Santo Andre','{"utm_source":"session-b"}','b@example.test')$sql$,'sessao B com mesmo telefone cria sessao independente');
select isnt((select id from public.leads where reservation_token='11111111-1111-4111-8111-111111111111'),(select id from public.leads where reservation_token='22222222-2222-4222-8222-222222222222'),'telefone igual nao reutiliza o lead');
select isnt((select reservation_token from public.leads where email='a@example.test'),(select reservation_token from public.leads where email='b@example.test'),'telefone igual nao vaza token anterior');
select lives_ok($sql$select * from public.capture_lead_session_v2('11111111-1111-4111-8111-111111111111','Sessao A Atualizada','11944444444','lavieen','primeira','semana','Diadema','{"utm_source":"session-a-update"}','a@example.test')$sql$,'reenvio da mesma sessao e idempotente');
select is((select count(*) from public.leads where reservation_token='11111111-1111-4111-8111-111111111111')::bigint,1::bigint,'reenvio nao duplica lead');
select is((select city from public.leads where reservation_token='11111111-1111-4111-8111-111111111111'),'Diadema','reenvio atualiza a mesma sessao');

select throws_ok($sql$select public.record_lead_event((select id from public.leads where reservation_token='11111111-1111-4111-8111-111111111111'),'99999999-9999-4999-8999-999999999999','whatsapp_opened','{}',null)$sql$,'P0001','Sessao de lead invalida','token incorreto nao cria evento');
select throws_ok($sql$select public.record_lead_event((select id from public.leads where reservation_token='11111111-1111-4111-8111-111111111111'),'11111111-1111-4111-8111-111111111111','payment_confirmed','{}',null)$sql$,'P0001','Evento publico nao permitido','evento arbitrario e recusado');
select lives_ok($sql$select public.record_lead_event((select id from public.leads where reservation_token='11111111-1111-4111-8111-111111111111'),'11111111-1111-4111-8111-111111111111','whatsapp_opened','{"context":"test"}',null)$sql$,'evento valido e aceito');
select is((select count(*) from public.lead_events where event_type='whatsapp_opened')::bigint,1::bigint,'whatsapp_opened fica persistido');

insert into public.slots(service_id,starts_at,ends_at,status,notes) select id,now()+interval '2 days',now()+interval '2 days 1 hour','open','commercial-funnel-test' from public.services where slug='lavieen';
select lives_ok($sql$select public.record_lead_event((select id from public.leads where reservation_token='11111111-1111-4111-8111-111111111111'),'11111111-1111-4111-8111-111111111111','slots_viewed','{}',null)$sql$,'slots_viewed e aceito');
select lives_ok($sql$select public.record_lead_event((select id from public.leads where reservation_token='11111111-1111-4111-8111-111111111111'),'11111111-1111-4111-8111-111111111111','booking_started','{}',null)$sql$,'booking_started e aceito');
create temporary table funnel_test_booking as select * from public.reserve_slot_secure((select id from public.leads where reservation_token='11111111-1111-4111-8111-111111111111'),'11111111-1111-4111-8111-111111111111',(select id from public.slots where notes='commercial-funnel-test'));
select is((select booking_status from funnel_test_booking),'awaiting_payment','reserve_slot_secure permanece compativel');
select is((select status from public.slots where notes='commercial-funnel-test'),'reserved','reserva bloqueia o horario');
select is((select status from public.leads where reservation_token='11111111-1111-4111-8111-111111111111'),'scheduled','lead fica scheduled depois da reserva');
select is((select count(*) from public.lead_events e join public.leads l on l.id=e.lead_id where e.event_type='booking_completed' and l.reservation_token='11111111-1111-4111-8111-111111111111')::bigint,1::bigint,'booking_completed e criado pelo backend');
update public.bookings set payment_expires_at=now()-interval '1 minute' where id=(select booking_id from funnel_test_booking);
select public.release_expired_reservations();
select is((select status from public.bookings where id=(select booking_id from funnel_test_booking)),'expired','pre-reserva expira');
select is((select status from public.slots where notes='commercial-funnel-test'),'open','horario volta a ficar disponivel');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated','recepcao@example.test','',now(),'{}','{}',now(),now()),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','authenticated','authenticated','profissional@example.test','',now(),'{}','{}',now(),now());
insert into public.staff_profiles(user_id,full_name,email,role,active,is_master) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Recepcao Teste','recepcao@example.test','receptionist',true,false),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Profissional Teste','profissional@example.test','professional',true,false)
on conflict(user_id) do update set role=excluded.role,active=true;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select ok((select count(*) from public.lead_events)>0,'recepcao autenticada consulta historico');
select lives_ok(format('select public.set_lead_commercial_status(%s,%L)',(select id from public.leads where reservation_token='22222222-2222-4222-8222-222222222222'),'contacted'),'recepcao altera status comercial');
reset role;
select * from finish();
rollback;
