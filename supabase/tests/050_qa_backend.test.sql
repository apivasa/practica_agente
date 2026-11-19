-- QA C-03/C-04: escrituras del backend (scripts/lib/db.js) tal como las emite PostgREST
-- con la clave secreta (rol service_role), y que ningún usuario pueda fabricar alertas.
--   C-03: "idempotente (correr dos veces no duplica)" -> upsert en evaluations.
--   C-04: "exactamente una alerta por destinatario; agrupación sin duplicados" -> dedupe_key única.
--   Diseño, Alertas: disparadores cerrados (cambio de color, atraso, ingreso P0/P1, vencimiento).
begin;
select plan(22);

-- Fixture propio (como postgres). UUID exclusivos de este archivo.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000005001', 'fx-qa50-comite@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000005002', 'fx-qa50-lider@example.test',  'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('bbbbbbbb-0000-4000-8000-000000005001', 'FX Unidad QA50', 'aaaaaaaa-0000-4000-8000-000000005002');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('cccccccc-0000-4000-8000-000000005001', 'FX_QA50', 'FX QA50', 'window_average', 'higher_is_better', 99.9, 99.5);
insert into public.user_roles (user_id, role, unit_id) values
  ('aaaaaaaa-0000-4000-8000-000000005001', 'committee',   null),
  ('aaaaaaaa-0000-4000-8000-000000005002', 'unit_leader', 'bbbbbbbb-0000-4000-8000-000000005001');

-- ---------------------------------------------------------------------------
-- Backend (service_role)
-- ---------------------------------------------------------------------------
set local role service_role;

-- evaluations: upsert por (unit_id, indicator_id, month), como onConflict de supabase-js
select lives_ok(
  $$ insert into public.evaluations (unit_id, indicator_id, month, color, sample_size)
     values ('bbbbbbbb-0000-4000-8000-000000005001', 'cccccccc-0000-4000-8000-000000005001', '2027-01', 'yellow', 1)
     on conflict (unit_id, indicator_id, month) do update set color = excluded.color, sample_size = excluded.sample_size $$,
  'service_role: upsert de evaluación por indicador (alta)');
select lives_ok(
  $$ insert into public.evaluations (unit_id, indicator_id, month, color, sample_size)
     values ('bbbbbbbb-0000-4000-8000-000000005001', 'cccccccc-0000-4000-8000-000000005001', '2027-01', 'red', 2)
     on conflict (unit_id, indicator_id, month) do update set color = excluded.color, sample_size = excluded.sample_size $$,
  'service_role: upsert de evaluación por indicador (reproceso)');
select is(
  (select count(*)::int from public.evaluations
    where unit_id = 'bbbbbbbb-0000-4000-8000-000000005001' and indicator_id = 'cccccccc-0000-4000-8000-000000005001' and month = '2027-01'),
  1, 'reproceso del mismo mes no duplica la evaluación por indicador');
select is(
  (select color::text from public.evaluations
    where unit_id = 'bbbbbbbb-0000-4000-8000-000000005001' and indicator_id = 'cccccccc-0000-4000-8000-000000005001' and month = '2027-01'),
  'red', 'el reproceso actualiza el color');

-- Fila global (indicator_id nulo): NULLS NOT DISTINCT debe servir de árbitro del upsert
select lives_ok(
  $$ insert into public.evaluations (unit_id, indicator_id, month, color, escalation_level, restrictions)
     values ('bbbbbbbb-0000-4000-8000-000000005001', null, '2027-01', 'red', 'restricted', array['no_backlog_additions'])
     on conflict (unit_id, indicator_id, month) do update set color = excluded.color,
       escalation_level = excluded.escalation_level, restrictions = excluded.restrictions $$,
  'service_role: upsert de evaluación global (alta)');
select lives_ok(
  $$ insert into public.evaluations (unit_id, indicator_id, month, color, escalation_level, restrictions)
     values ('bbbbbbbb-0000-4000-8000-000000005001', null, '2027-01', 'red', 'restricted', array['no_backlog_additions'])
     on conflict (unit_id, indicator_id, month) do update set color = excluded.color,
       escalation_level = excluded.escalation_level, restrictions = excluded.restrictions $$,
  'service_role: upsert de evaluación global (segunda corrida)');
select is(
  (select count(*)::int from public.evaluations
    where unit_id = 'bbbbbbbb-0000-4000-8000-000000005001' and indicator_id is null and month = '2027-01'),
  1, 'segunda corrida no duplica la evaluación global (indicador nulo)');

-- alerts: una por disparador y destinatario
select lives_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind, payload, dedupe_key) values
     ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005001', 'color_change', '{"month":"2027-01"}',
      'color_change:qa50:2027-01:red:restricted:aaaaaaaa-0000-4000-8000-000000005001'),
     ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005002', 'color_change', '{"month":"2027-01"}',
      'color_change:qa50:2027-01:red:restricted:aaaaaaaa-0000-4000-8000-000000005002') $$,
  'service_role: inserta una alerta por destinatario (comité y líder)');
select throws_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind, dedupe_key) values
     ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005001', 'color_change',
      'color_change:qa50:2027-01:red:restricted:aaaaaaaa-0000-4000-8000-000000005001') $$,
  '23505', null, 'segundo insert con la misma dedupe_key se rechaza');
select is_empty(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind, dedupe_key) values
     ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005001', 'color_change',
      'color_change:qa50:2027-01:red:restricted:aaaaaaaa-0000-4000-8000-000000005001')
     on conflict (dedupe_key) do nothing returning id $$,
  'upsert ignoreDuplicates (on conflict do nothing) no devuelve ni crea fila');
select is(
  (select count(*)::int from public.alerts where unit_id = 'bbbbbbbb-0000-4000-8000-000000005001'),
  2, 'tras reintentos siguen exactamente 2 alertas (una por destinatario)');
select lives_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind, dedupe_key)
     values ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005001', 'pace_behind', 'pace_behind:qa50:2027-02-10:c'),
            ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005001', 'critical_intake', 'critical_intake:qa50:2200:c'),
            ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005001', 'exception_expired', 'exception_expired:qa50:expired:c') $$,
  'los otros tres disparadores del diseño se aceptan');
select throws_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind, dedupe_key)
     values ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005001', 'other', 'other:qa50') $$,
  '23514', null, 'kind fuera de los disparadores del diseño se rechaza');
select throws_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind, dedupe_key)
     values ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005001', 'Color_Change', 'cc-mayus:qa50') $$,
  '23514', null, 'kind distingue mayúsculas (no hay variantes del mismo disparador)');
select throws_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind, dedupe_key)
     values ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005001', 'color_change', '   ') $$,
  '23514', null, 'dedupe_key en blanco se rechaza');

-- Auditoría de la acción automática (CLAUDE.md §4): el backend inserta, no reescribe
select lives_ok(
  $$ insert into public.audit_log (actor, action, entity, entity_id, details)
     values ('system:evaluate', 'alert_sent', 'alerts', 'qa50', '{}') $$,
  'service_role: registra alert_sent en audit_log');
select throws_ok(
  $$ update public.audit_log set action = 'x' where entity_id = 'qa50' $$,
  '42501', null, 'service_role no puede reescribir la auditoría');

reset role;

-- ---------------------------------------------------------------------------
-- Usuarios (authenticated): no fabrican alertas ni evaluaciones
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000005001","role":"authenticated"}';
select throws_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind, dedupe_key)
     values ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005002', 'color_change', 'fake:comite') $$,
  '42501', null, 'comité (authenticated) no puede insertar alertas');
select throws_ok(
  $$ update public.alerts set dedupe_key = 'x' where unit_id = 'bbbbbbbb-0000-4000-8000-000000005001' $$,
  '42501', null, 'comité no puede cambiar dedupe_key (solo read_at)');
select throws_ok(
  $$ insert into public.evaluations (unit_id, indicator_id, month, color)
     values ('bbbbbbbb-0000-4000-8000-000000005001', null, '2027-02', 'green') $$,
  '42501', null, 'comité no puede escribir evaluaciones');

set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000005002","role":"authenticated"}';
select throws_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind, dedupe_key)
     values ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005002', 'color_change', 'fake:lider') $$,
  '42501', null, 'líder (authenticated) no puede insertar alertas');
select throws_ok(
  $$ insert into public.alerts (unit_id, recipient_user_id, kind, dedupe_key)
     values ('bbbbbbbb-0000-4000-8000-000000005001', 'aaaaaaaa-0000-4000-8000-000000005002', 'color_change', 'fake:lider2')
     on conflict (dedupe_key) do nothing $$,
  '42501', null, 'líder tampoco por la vía upsert (on conflict do nothing)');

reset role;
select * from finish();
rollback;
