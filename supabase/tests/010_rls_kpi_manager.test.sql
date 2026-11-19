-- F-04: RLS para la gestora de KPIs (kpi_manager).
-- Debe: leer todo; escribir units, user_roles, indicators, targets; leer audit_log.
-- No debe: escribir commitments, measurements, exceptions, evaluations, alerts, audit_log.
begin;
select plan(24);

-- Fixture propio (como postgres, antes de cambiar de rol). UUID distintos a
-- los del seed para no chocar si el seed ya está cargado.
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'fx-gestora@example.test',  'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'fx-custodio1@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'fx-custodio2@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'fx-comite@example.test',   'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'fx-lider1@example.test',   'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000006', 'fx-lider2@example.test',   'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000007', 'fx-sinrol@example.test',   'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'FX Unidad 1', 'aaaaaaaa-0000-4000-8000-000000000005'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'FX Unidad 2', 'aaaaaaaa-0000-4000-8000-000000000006');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, custodian_user_id) values
  ('cccccccc-0000-4000-8000-000000000001', 'FX_VULN',  'FX Vulnerabilidades', 'cumulative_target', 'higher_is_better', 96, 90, 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('cccccccc-0000-4000-8000-000000000002', 'FX_AVAIL', 'FX Disponibilidad',   'window_average',    'higher_is_better', 99.9, 99.5, 'aaaaaaaa-0000-4000-8000-000000000003');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'kpi_manager', null, null),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'custodian',   null, 'cccccccc-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'custodian',   null, 'cccccccc-0000-4000-8000-000000000002'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'committee',   null, null),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'unit_leader', 'bbbbbbbb-0000-4000-8000-000000000001', null),
  ('aaaaaaaa-0000-4000-8000-000000000006', 'unit_leader', 'bbbbbbbb-0000-4000-8000-000000000002', null);
insert into public.commitments (id, unit_id, indicator_id, period, package_total, notes, created_by) values
  ('dddddddd-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-Q1', 2000, 'orig', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('dddddddd-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001', '2027-Q1', 1500, 'orig', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('dddddddd-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', '2027-Q1', null, 'orig', 'aaaaaaaa-0000-4000-8000-000000000003');
insert into public.measurements (id, unit_id, indicator_id, measured_on, value, created_by) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-01-31', 400, 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001', '2027-01-31', 300, 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', '2027-01-15', 99.95, 'aaaaaaaa-0000-4000-8000-000000000003'),
  ('eeeeeeee-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000002', '2027-01-15', 99.10, 'aaaaaaaa-0000-4000-8000-000000000003');
insert into public.targets (id, unit_id, indicator_id, month, target_value) values
  ('ffffffff-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-01', 667),
  ('ffffffff-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001', '2027-01', 500);
insert into public.evaluations (id, unit_id, indicator_id, month, color, sample_size) values
  ('99999999-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', null, '2027-01', 'green', 0),
  ('99999999-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', null, '2027-01', 'red', 0),
  ('99999999-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-01', 'green', 1);
insert into public.exceptions (id, unit_id, scope, reason, expires_on, approved_by) values
  ('88888888-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'change_start', 'FX urgente 1', '2027-02-28', 'aaaaaaaa-0000-4000-8000-000000000004'),
  ('88888888-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'all',          'FX urgente 2', '2027-02-28', 'aaaaaaaa-0000-4000-8000-000000000004');
insert into public.alerts (id, unit_id, recipient_user_id, kind, payload) values
  ('77777777-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000005', 'color_change', '{}'),
  ('77777777-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000006', 'color_change', '{}'),
  ('77777777-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000004', 'color_change', '{}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

-- Lecturas
select is((select count(*)::int from public.units where id in ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002')), 2, 'gestora: ve todas las unidades');
select is((select count(*)::int from public.measurements where id::text like 'eeeeeeee-%'), 4, 'gestora: ve todas las mediciones');
select is((select count(*)::int from public.commitments where id::text like 'dddddddd-%'), 3, 'gestora: ve todos los compromisos');
select is((select count(*)::int from public.evaluations where id::text like '99999999-%'), 3, 'gestora: ve todas las evaluaciones');
select is((select count(*)::int from public.exceptions where id::text like '88888888-%'), 2, 'gestora: ve todas las excepciones');
select is((select count(*)::int from public.alerts where id::text like '77777777-%'), 3, 'gestora: ve todas las alertas');
select is((select count(*)::int from public.user_roles where user_id::text like 'aaaaaaaa-%'), 6, 'gestora: ve todos los roles');
select isnt_empty('select 1 from public.audit_log', 'gestora: lee audit_log');

-- Escrituras permitidas
select lives_ok($$ insert into public.units (id, name) values ('bbbbbbbb-0000-4000-8000-000000000009', 'FX Unidad nueva') $$, 'gestora: crea unidad');
select lives_ok($$ update public.units set name = 'FX Unidad renombrada' where id = 'bbbbbbbb-0000-4000-8000-000000000009' $$, 'gestora: actualiza unidad');
select is((select name from public.units where id = 'bbbbbbbb-0000-4000-8000-000000000009'), 'FX Unidad renombrada', 'gestora: la actualización de unidad se aplicó');
select lives_ok($$ delete from public.units where id = 'bbbbbbbb-0000-4000-8000-000000000009' $$, 'gestora: borra unidad');
select is((select count(*)::int from public.units where id = 'bbbbbbbb-0000-4000-8000-000000000009'), 0, 'gestora: la unidad quedó borrada');
select lives_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_NEW', 'FX nuevo', 'coverage', 'higher_is_better', 90, 75) $$,
  'gestora: crea indicador');
select lives_ok($$ update public.indicators set green_threshold = 97 where id = 'cccccccc-0000-4000-8000-000000000001' $$, 'gestora: actualiza umbral');
select lives_ok(
  $$ insert into public.user_roles (user_id, role) values ('aaaaaaaa-0000-4000-8000-000000000007', 'committee') $$,
  'gestora: asigna rol');
select lives_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-02', 1333) $$,
  'gestora: crea meta');

-- Escrituras prohibidas
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-Q3', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501', null, 'gestora: no crea compromisos');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-02-01', 1, 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501', null, 'gestora: no carga mediciones');
select throws_ok(
  $$ insert into public.exceptions (unit_id, reason, expires_on, approved_by)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'x', '2027-03-01', 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501', null, 'gestora: no aprueba excepciones');
select throws_ok(
  $$ insert into public.evaluations (unit_id, month, color) values ('bbbbbbbb-0000-4000-8000-000000000001', '2027-02', 'green') $$,
  '42501', null, 'gestora: no escribe evaluaciones');
select throws_ok(
  $$ insert into public.alerts (recipient_user_id, kind) values ('aaaaaaaa-0000-4000-8000-000000000001', 'x') $$,
  '42501', null, 'gestora: no inserta alertas');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'gestora: no borra audit_log');
select throws_ok($$ truncate public.units cascade $$, '42501', null, 'gestora: no puede truncar tablas');

select * from finish();
rollback;
