-- C-05 QA independiente: estado de correo de alerts (emailed_at, email_attempts).
-- Traza al criterio: "correr dos veces no reenvía" (marca condicional, nadie puede
-- desmarcar para forzar un reenvío), "reintentos hasta 3" (contador acotado que ningún
-- usuario reinicia), "cada envío en auditoría" (ningún usuario falsifica la auditoría
-- del envío) y "no expone datos de otras unidades" (RLS de alerts sin cambios).
begin;
select plan(22);

insert into auth.users (id, email, aud, role) values
  ('c05a0000-0000-4000-8000-000000000001', 'qa-c05-gestora@example.test', 'authenticated', 'authenticated'),
  ('c05a0000-0000-4000-8000-000000000002', 'qa-c05-custodio@example.test', 'authenticated', 'authenticated'),
  ('c05a0000-0000-4000-8000-000000000003', 'qa-c05-comite@example.test', 'authenticated', 'authenticated'),
  ('c05a0000-0000-4000-8000-000000000004', 'qa-c05-lider1@example.test', 'authenticated', 'authenticated'),
  ('c05a0000-0000-4000-8000-000000000005', 'qa-c05-lider2@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('c05a1000-0000-4000-8000-000000000001', 'QA C05 Unidad 1'),
  ('c05a1000-0000-4000-8000-000000000002', 'QA C05 Unidad 2');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('c05a2000-0000-4000-8000-000000000001', 'QA_C05', 'QA C05 KPI', 'window_average', 'higher_is_better', 99, 95);
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('c05a0000-0000-4000-8000-000000000001', 'kpi_manager', null, null),
  ('c05a0000-0000-4000-8000-000000000002', 'custodian', null, 'c05a2000-0000-4000-8000-000000000001'),
  ('c05a0000-0000-4000-8000-000000000003', 'committee', null, null),
  ('c05a0000-0000-4000-8000-000000000004', 'unit_leader', 'c05a1000-0000-4000-8000-000000000001', null),
  ('c05a0000-0000-4000-8000-000000000005', 'unit_leader', 'c05a1000-0000-4000-8000-000000000002', null);
insert into public.alerts (id, unit_id, recipient_user_id, kind, payload) values
  ('c05a3000-0000-4000-8000-000000000001', 'c05a1000-0000-4000-8000-000000000001', 'c05a0000-0000-4000-8000-000000000004', 'color_change', '{"unit_name":"QA C05 Unidad 1"}'),
  ('c05a3000-0000-4000-8000-000000000002', 'c05a1000-0000-4000-8000-000000000002', 'c05a0000-0000-4000-8000-000000000005', 'color_change', '{"unit_name":"QA C05 Unidad 2"}'),
  ('c05a3000-0000-4000-8000-000000000003', 'c05a1000-0000-4000-8000-000000000001', 'c05a0000-0000-4000-8000-000000000003', 'pace_behind', '{"unit_name":"QA C05 Unidad 1"}');

-- Estructura.
select col_type_is('public', 'alerts', 'emailed_at', 'timestamp with time zone', 'emailed_at es timestamptz');
select col_is_null('public', 'alerts', 'emailed_at', 'emailed_at admite nulo (pendiente)');
select has_index('public', 'alerts', 'alerts_email_pending_idx', 'índice de pendientes de correo');
select is((select count(*)::int from public.alerts where id::text like 'c05a3000%' and emailed_at is null and email_attempts = 0), 3,
  'alertas nuevas: pendientes y con 0 intentos');

-- Tope del contador.
select lives_ok($$ update public.alerts set email_attempts = 100 where id = 'c05a3000-0000-4000-8000-000000000001' $$,
  'email_attempts = 100 se acepta (borde)');
select throws_ok($$ update public.alerts set email_attempts = 101 where id = 'c05a3000-0000-4000-8000-000000000001' $$,
  '23514', null, 'email_attempts = 101 se rechaza');
update public.alerts set email_attempts = 0 where id = 'c05a3000-0000-4000-8000-000000000001';

-- Idempotencia de la marca (lo que hace el backend: update ... where emailed_at is null).
select is(
  (with u as (update public.alerts set emailed_at = now(), email_attempts = 1
              where id = 'c05a3000-0000-4000-8000-000000000001' and emailed_at is null returning 1)
   select count(*)::int from u), 1, 'backend: la primera marca afecta a la alerta');
select is(
  (with u as (update public.alerts set emailed_at = now(), email_attempts = 2
              where id = 'c05a3000-0000-4000-8000-000000000001' and emailed_at is null returning 1)
   select count(*)::int from u), 0, 'backend: la segunda marca no afecta (no reenvía)');
select is((select email_attempts::int from public.alerts where id = 'c05a3000-0000-4000-8000-000000000001'), 1,
  'la segunda marca no cambia los intentos');

set local role authenticated;

-- Líder 1 (destinatario de la alerta 1).
set local request.jwt.claims = '{"sub":"c05a0000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select emailed_at is not null from public.alerts where id = 'c05a3000-0000-4000-8000-000000000001'), true,
  'líder: ve el estado de correo de su propia alerta');
select throws_ok(
  $$ update public.alerts set read_at = now(), emailed_at = null where id = 'c05a3000-0000-4000-8000-000000000001' $$,
  '42501', null, 'líder: no desmarca emailed_at ni junto con read_at (forzar reenvío)');
select throws_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind) values
     ('c05a1000-0000-4000-8000-000000000001', 'c05a0000-0000-4000-8000-000000000004', 'color_change') $$,
  '42501', null, 'líder: no crea alertas (no provoca correos)');
select throws_ok(
  $$ delete from public.alerts where id = 'c05a3000-0000-4000-8000-000000000001' $$,
  '42501', null, 'líder: no borra alertas');
select is((select count(*)::int from public.alerts where unit_id = 'c05a1000-0000-4000-8000-000000000002'), 0,
  'líder 1: no ve alertas (ni su estado de correo) de la unidad 2');
select throws_ok(
  $$ insert into public.audit_log (actor, action, entity, entity_id, details) values
     ('system:alert-email', 'alert_emailed', 'alerts', 'c05a3000-0000-4000-8000-000000000002', '{}') $$,
  '42501', null, 'líder: no falsifica la auditoría de un envío');

-- Líder 2: no ve alertas de la unidad 1.
set local request.jwt.claims = '{"sub":"c05a0000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.alerts where id::text like 'c05a3000%'), 1, 'líder 2: solo su alerta');

-- Comité: lee todas, no reinicia intentos ni crea auditoría.
set local request.jwt.claims = '{"sub":"c05a0000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.alerts where id::text like 'c05a3000%'), 3, 'comité: lee todas');
select throws_ok(
  $$ update public.alerts set email_attempts = 0 where id = 'c05a3000-0000-4000-8000-000000000003' $$,
  '42501', null, 'comité: no reinicia email_attempts');
select throws_ok(
  $$ insert into public.audit_log (actor, action, entity, entity_id, details) values
     ('system:alert-email', 'alert_emailed', 'alerts', 'c05a3000-0000-4000-8000-000000000003', '{}') $$,
  '42501', null, 'comité: no falsifica la auditoría de un envío');

-- Gestora: no desmarca.
set local request.jwt.claims = '{"sub":"c05a0000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ update public.alerts set emailed_at = null where id = 'c05a3000-0000-4000-8000-000000000001' $$,
  '42501', null, 'gestora: no desmarca emailed_at');

-- Custodio: no ve ni reinicia.
set local request.jwt.claims = '{"sub":"c05a0000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ update public.alerts set email_attempts = 0 where id = 'c05a3000-0000-4000-8000-000000000002' $$,
  '42501', null, 'custodio: no reinicia email_attempts');

-- Anónimo.
reset role;
set local role anon;
select throws_ok(
  $$ update public.alerts set emailed_at = null $$,
  '42501', null, 'anon: no toca el estado de correo');

select * from finish();
rollback;
