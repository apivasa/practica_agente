-- F-04 (endurecimiento): columnas inmutables, origen automático solo backend,
-- excepciones (unidad inmutable, vencimiento no pasado), auditoría ampliada,
-- FKs RESTRICT, audit_log append-only, privilegios por defecto y columnas M-05.
begin;
select plan(33);

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
-- Estructura
select has_trigger('public', 'measurements', 'audit_measurements', 'trigger de auditoría en measurements');
select has_trigger('public', 'targets', 'audit_targets', 'trigger de auditoría en targets');
select has_trigger('public', 'units', 'audit_units', 'trigger de auditoría en units');
select has_column('public', 'commitments', 'package_by_category', 'commitments.package_by_category existe');
select has_column('public', 'measurements', 'kind', 'measurements.kind existe');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-01-01', 1, 'otro') $$,
  '23514', null, 'measurements.kind solo admite resolved/detected');
select throws_ok(
  $$ update public.commitments set package_by_category = '[1]' where id = 'dddddddd-0000-4000-8000-000000000001' $$,
  '23514', null, 'commitments.package_by_category debe ser objeto');

-- Privilegios por defecto: una tabla nueva en public no se expone sola
create table public.zz_default_priv_probe (id int);
select ok(not has_table_privilege('anon', 'public.zz_default_priv_probe', 'SELECT'), 'tabla nueva: anon sin SELECT por defecto');
select ok(not has_table_privilege('authenticated', 'public.zz_default_priv_probe', 'SELECT'), 'tabla nueva: authenticated sin SELECT por defecto');
drop table public.zz_default_priv_probe;

-- Custodio de FX_VULN
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ update public.measurements set value = 410, kind = 'resolved' where id = 'eeeeeeee-0000-4000-8000-000000000001' $$, 'custodio: corrige el valor de su medición');
select throws_ok($$ update public.measurements set unit_id = 'bbbbbbbb-0000-4000-8000-000000000002' where id = 'eeeeeeee-0000-4000-8000-000000000001' $$, '42501', null, 'custodio: no cambia la unidad de una medición');
select throws_ok($$ update public.measurements set created_by = 'aaaaaaaa-0000-4000-8000-000000000003' where id = 'eeeeeeee-0000-4000-8000-000000000001' $$, '42501', null, 'custodio: no cambia created_by de una medición');
select throws_ok($$ update public.measurements set source = 'automatic' where id = 'eeeeeeee-0000-4000-8000-000000000001' $$, '42501', null, 'custodio: no cambia source de una medición');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, source)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-02-01', 1, 'automatic') $$,
  '42501', null, 'custodio: no inserta mediciones con source automatic');
select lives_ok($$ update public.commitments set package_by_category = '{"P0P1": 500, "P2P3": 1500}' where id = 'dddddddd-0000-4000-8000-000000000001' $$, 'custodio: registra paquete por categoría');
select throws_ok($$ update public.commitments set unit_id = 'bbbbbbbb-0000-4000-8000-000000000002' where id = 'dddddddd-0000-4000-8000-000000000001' $$, '42501', null, 'custodio: no cambia la unidad de un compromiso');
select throws_ok($$ update public.commitments set created_by = 'aaaaaaaa-0000-4000-8000-000000000003' where id = 'dddddddd-0000-4000-8000-000000000001' $$, '42501', null, 'custodio: no cambia created_by de un compromiso');

-- Comité
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ update public.exceptions set unit_id = 'bbbbbbbb-0000-4000-8000-000000000002' where id = '88888888-0000-4000-8000-000000000001' $$, '42501', null, 'comité: no cambia la unidad de una excepción');
select throws_ok(
  $$ insert into public.exceptions (unit_id, reason, expires_on) values ('bbbbbbbb-0000-4000-8000-000000000001', 'vencida', (now() at time zone 'America/Guayaquil')::date - 1) $$,
  '42501', null, 'comité: no crea excepciones ya vencidas');
select lives_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, expires_on) values ('bbbbbbbb-0000-4000-8000-000000000001', 'all', 'vence hoy', (now() at time zone 'America/Guayaquil')::date) $$,
  'comité: crea excepción que vence hoy');

-- Gestora: RESTRICT preserva historial
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ delete from public.units where id = 'bbbbbbbb-0000-4000-8000-000000000001' $$, '23503', null, 'gestora: no borra una unidad con historial');
select throws_ok($$ delete from public.indicators where id = 'cccccccc-0000-4000-8000-000000000001' $$, '23503', null, 'gestora: no borra un indicador con historial');
select lives_ok(
  $$ update public.targets set target_value = 700 where id = 'ffffffff-0000-4000-8000-000000000001' $$,
  'gestora: ajusta una meta');

-- Backend (service_role) y dueño: audit_log append-only
reset role;
select throws_ok($$ update public.exceptions set unit_id = 'bbbbbbbb-0000-4000-8000-000000000002' where id = '88888888-0000-4000-8000-000000000001' $$, 'P0001', null, 'backend: exceptions.unit_id también es inmutable');
select is(
  (select count(*)::int from public.audit_log
   where entity = 'measurements' and action = 'update' and entity_id = 'eeeeeeee-0000-4000-8000-000000000001'
     and actor = 'aaaaaaaa-0000-4000-8000-000000000002'),
  1, 'auditoría: corrección de medición por custodio');
select is(
  (select count(*)::int from public.audit_log
   where entity = 'targets' and action = 'update' and entity_id = 'ffffffff-0000-4000-8000-000000000001'
     and actor = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1, 'auditoría: ajuste de meta por gestora');
select isnt_empty(
  $$ select 1 from public.audit_log where entity = 'units' and action = 'insert' and entity_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'auditoría: alta de unidad');
select throws_ok($$ update public.audit_log set actor = 'x' $$, '42501', null, 'dueño: audit_log no se actualiza (trigger)');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'dueño: audit_log no se borra (trigger)');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'dueño: audit_log no se trunca (trigger)');
set local role service_role;
select throws_ok($$ update public.audit_log set actor = 'x' $$, '42501', null, 'service_role: no actualiza audit_log');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'service_role: no borra audit_log');
select lives_ok($$ insert into public.audit_log (actor, action, entity) values ('system:test', 'probe', 'audit_log') $$, 'service_role: sí inserta en audit_log');

select * from finish();
rollback;
