-- C-06 QA independiente: columnas de omisión del correo en alerts
-- (email_skipped_at, email_skip_reason). Traza al criterio:
--   H-C05-01 "no enviar si el destinatario perdió rol/unidad o está bloqueado (auditar
--   alert_email_skipped)" y QA-C05-1 "auditar alertas que salen de la ventana": solo el
--   backend marca la omisión; ningún rol de usuario la marca, la desmarca (forzar un
--   reenvío) ni falsifica su auditoría. Diseño: la bandeja de la app sigue mostrando las
--   mismas alertas (el destinatario ve y marca como leída su alerta omitida) y RLS de
--   alerts no cambia (nadie ve la omisión de alertas ajenas salvo gestora y comité).
-- Un caso por rol que debe ver/escribir y otro por rol que no debe.
begin;
select plan(26);

insert into auth.users (id, email, aud, role) values
  ('c06b0000-0000-4000-8000-000000000001', 'qa-c06-gestora@example.test', 'authenticated', 'authenticated'),
  ('c06b0000-0000-4000-8000-000000000002', 'qa-c06-custodio@example.test', 'authenticated', 'authenticated'),
  ('c06b0000-0000-4000-8000-000000000003', 'qa-c06-comite@example.test', 'authenticated', 'authenticated'),
  ('c06b0000-0000-4000-8000-000000000004', 'qa-c06-lider1@example.test', 'authenticated', 'authenticated'),
  ('c06b0000-0000-4000-8000-000000000005', 'qa-c06-lider2@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('c06b1000-0000-4000-8000-000000000001', 'QA C06 Unidad 1'),
  ('c06b1000-0000-4000-8000-000000000002', 'QA C06 Unidad 2');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('c06b2000-0000-4000-8000-000000000001', 'QA_C06', 'QA C06 KPI', 'window_average', 'higher_is_better', 99, 95);
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('c06b0000-0000-4000-8000-000000000001', 'kpi_manager', null, null),
  ('c06b0000-0000-4000-8000-000000000002', 'custodian', null, 'c06b2000-0000-4000-8000-000000000001'),
  ('c06b0000-0000-4000-8000-000000000003', 'committee', null, null),
  ('c06b0000-0000-4000-8000-000000000004', 'unit_leader', 'c06b1000-0000-4000-8000-000000000001', null),
  ('c06b0000-0000-4000-8000-000000000005', 'unit_leader', 'c06b1000-0000-4000-8000-000000000002', null);
insert into public.alerts (id, unit_id, recipient_user_id, kind, payload) values
  ('c06b3000-0000-4000-8000-000000000001', 'c06b1000-0000-4000-8000-000000000001', 'c06b0000-0000-4000-8000-000000000004', 'color_change', '{"unit_name":"QA C06 Unidad 1"}'),
  ('c06b3000-0000-4000-8000-000000000002', 'c06b1000-0000-4000-8000-000000000002', 'c06b0000-0000-4000-8000-000000000005', 'color_change', '{"unit_name":"QA C06 Unidad 2"}'),
  ('c06b3000-0000-4000-8000-000000000003', 'c06b1000-0000-4000-8000-000000000001', 'c06b0000-0000-4000-8000-000000000003', 'pace_behind', '{"unit_name":"QA C06 Unidad 1"}');

-- Motivos admitidos: los cuatro que usa el backend (scripts/lib/email.js SKIP_REASONS).
select lives_ok($$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'expired' where id = 'c06b3000-0000-4000-8000-000000000003' $$,
  'motivo expired (QA-C05-1) admitido');
update public.alerts set email_skipped_at = null, email_skip_reason = null where id = 'c06b3000-0000-4000-8000-000000000003';
select lives_ok($$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'recipient_missing' where id = 'c06b3000-0000-4000-8000-000000000003' $$,
  'motivo recipient_missing admitido');
update public.alerts set email_skipped_at = null, email_skip_reason = null where id = 'c06b3000-0000-4000-8000-000000000003';
select lives_ok($$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'recipient_banned' where id = 'c06b3000-0000-4000-8000-000000000003' $$,
  'motivo recipient_banned admitido');
update public.alerts set email_skipped_at = null, email_skip_reason = null where id = 'c06b3000-0000-4000-8000-000000000003';
select lives_ok($$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'recipient_no_role' where id = 'c06b3000-0000-4000-8000-000000000003' $$,
  'motivo recipient_no_role admitido');
update public.alerts set email_skipped_at = null, email_skip_reason = null where id = 'c06b3000-0000-4000-8000-000000000003';
select throws_ok($$ update public.alerts set email_skipped_at = now(), email_skip_reason = '' where id = 'c06b3000-0000-4000-8000-000000000003' $$,
  '23514', null, 'motivo vacío rechazado');

-- Backend (service_role) marca la omisión de la alerta del líder 1 (perdió el rol, p. ej.).
set local role service_role;
update public.alerts set email_skipped_at = '2030-01-01T00:00:00Z', email_skip_reason = 'recipient_no_role'
  where id = 'c06b3000-0000-4000-8000-000000000001' and emailed_at is null and email_skipped_at is null;
select is((select count(*)::int from public.alerts where id::text like 'c06b3000%' and emailed_at is null and email_skipped_at is null
            and email_attempts < 3),
  2, 'service_role: la alerta omitida ya no cuenta como pendiente de correo');
select lives_ok($$ insert into public.audit_log (actor, action, entity, entity_id, details) values
  ('system:alert-email', 'alert_email_skipped', 'alerts', 'c06b3000-0000-4000-8000-000000000001', '{"reason":"recipient_no_role"}') $$,
  'service_role: audita alert_email_skipped');
reset role;

set local role authenticated;

-- Líder 1 (destinatario): ve su alerta y su estado de omisión, la sigue marcando como leída,
-- pero no toca la omisión.
set local request.jwt.claims = '{"sub":"c06b0000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select email_skip_reason from public.alerts where id = 'c06b3000-0000-4000-8000-000000000001'), 'recipient_no_role',
  'líder 1: ve el estado de omisión de su alerta (la bandeja la sigue mostrando)');
select lives_ok($$ update public.alerts set read_at = now() where id = 'c06b3000-0000-4000-8000-000000000001' $$,
  'líder 1: marca como leída su alerta omitida');
select ok((select read_at is not null from public.alerts where id = 'c06b3000-0000-4000-8000-000000000001'),
  'líder 1: read_at quedó fijado');
select throws_ok($$ update public.alerts set read_at = now(), email_skipped_at = null, email_skip_reason = null where id = 'c06b3000-0000-4000-8000-000000000001' $$,
  '42501', null, 'líder 1: no desmarca la omisión (ni junto con read_at) para forzar el correo');
select is((select count(*)::int from public.alerts where id = 'c06b3000-0000-4000-8000-000000000002'), 0,
  'líder 1: no ve la alerta (ni la omisión) de la unidad 2');
select throws_ok($$ insert into public.audit_log (actor, action, entity, entity_id, details) values
  ('system:alert-email', 'alert_email_skipped', 'alerts', 'c06b3000-0000-4000-8000-000000000002', '{}') $$,
  '42501', null, 'líder 1: no falsifica una auditoría alert_email_skipped');

-- Líder 2: no ve ni marca la alerta del líder 1.
set local request.jwt.claims = '{"sub":"c06b0000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.alerts where id = 'c06b3000-0000-4000-8000-000000000001'), 0,
  'líder 2: no ve la alerta omitida del líder 1');
select throws_ok($$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'expired' where id = 'c06b3000-0000-4000-8000-000000000002' $$,
  '42501', null, 'líder 2: no marca como omitida su propia alerta (evitar el correo)');

-- Custodio: no es destinatario ni lector de alertas.
set local request.jwt.claims = '{"sub":"c06b0000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.alerts where id::text like 'c06b3000%'), 0,
  'custodio: no ve alertas ni su estado de omisión');
select throws_ok($$ update public.alerts set email_skip_reason = 'expired', email_skipped_at = now() where id = 'c06b3000-0000-4000-8000-000000000002' $$,
  '42501', null, 'custodio: no marca la omisión');

-- Comité: lee la omisión de cualquier unidad; no la escribe ni en sus propias alertas.
set local request.jwt.claims = '{"sub":"c06b0000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select email_skip_reason from public.alerts where id = 'c06b3000-0000-4000-8000-000000000001'), 'recipient_no_role',
  'comité: ve el estado de omisión de una alerta de otro destinatario');
select throws_ok($$ update public.alerts set email_skipped_at = now(), email_skip_reason = 'expired' where id = 'c06b3000-0000-4000-8000-000000000003' $$,
  '42501', null, 'comité: no marca como omitida su propia alerta');
select throws_ok($$ update public.alerts set email_skipped_at = null, email_skip_reason = null where id = 'c06b3000-0000-4000-8000-000000000001' $$,
  '42501', null, 'comité: no desmarca la omisión ajena');

-- Gestora: lee la omisión; no la escribe.
set local request.jwt.claims = '{"sub":"c06b0000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select email_skip_reason from public.alerts where id = 'c06b3000-0000-4000-8000-000000000001'), 'recipient_no_role',
  'gestora: ve el estado de omisión');
select throws_ok($$ update public.alerts set email_skipped_at = null, email_skip_reason = null where id = 'c06b3000-0000-4000-8000-000000000001' $$,
  '42501', null, 'gestora: no desmarca la omisión');

-- Anónimo.
reset role;
set local role anon;
select throws_ok($$ update public.alerts set email_skipped_at = null, email_skip_reason = null $$,
  '42501', null, 'anon: no toca la omisión');
reset role;

-- Estado final: la omisión hecha por el backend sigue intacta tras todos los intentos.
select ok((select email_skip_reason = 'recipient_no_role' and email_skipped_at = '2030-01-01T00:00:00Z' and emailed_at is null
           from public.alerts where id = 'c06b3000-0000-4000-8000-000000000001'),
  'la omisión del backend sigue intacta');
select ok((select email_skipped_at is null and email_skip_reason is null from public.alerts where id = 'c06b3000-0000-4000-8000-000000000002'),
  'ninguna alerta quedó omitida por un usuario');
select is((select count(*)::int from public.audit_log where action = 'alert_email_skipped' and entity_id::text like 'c06b3000%'), 1,
  'solo la auditoría del backend quedó registrada');

select * from finish();
rollback;
