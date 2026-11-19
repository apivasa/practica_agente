-- F-04: RLS para el custodio (custodian). El usuario de prueba custodia solo
-- FX_VULN (cccccccc-...-01); FX_AVAIL (…-02) es de otro custodio.
-- Debe: leer units, indicators, targets; leer/crear/actualizar commitments y
-- measurements de sus indicadores. No debe: tocar otros indicadores, borrar,
-- configurar, ver excepciones ni auditoría.
begin;
select plan(26);

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
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}';

-- Lecturas permitidas
select is((select count(*)::int from public.units where id::text like 'bbbbbbbb-%'), 2, 'custodio: ve las unidades');
select is((select count(*)::int from public.indicators where id::text like 'cccccccc-%'), 2, 'custodio: ve los indicadores');
select is((select count(*)::int from public.targets where id::text like 'ffffffff-%'), 2, 'custodio: ve las metas');
select is((select count(*)::int from public.measurements where indicator_id = 'cccccccc-0000-4000-8000-000000000001'), 2, 'custodio: ve mediciones de su KPI');
select is((select count(*)::int from public.commitments where indicator_id = 'cccccccc-0000-4000-8000-000000000001'), 2, 'custodio: ve compromisos de su KPI');
select is((select count(*)::int from public.evaluations where id::text like '99999999-%'), 1, 'custodio: ve solo evaluaciones de su KPI');
select is((select count(*)::int from public.user_roles), 1, 'custodio: solo ve su propio rol');

-- Lecturas que deben devolver 0 filas
select is((select count(*)::int from public.measurements where indicator_id = 'cccccccc-0000-4000-8000-000000000002'), 0, 'custodio: no ve mediciones de otro KPI');
select is((select count(*)::int from public.commitments where indicator_id = 'cccccccc-0000-4000-8000-000000000002'), 0, 'custodio: no ve compromisos de otro KPI');
select is((select count(*)::int from public.exceptions), 0, 'custodio: no ve excepciones');
select is((select count(*)::int from public.alerts), 0, 'custodio: no ve alertas ajenas');
select is_empty('select 1 from public.audit_log', 'custodio: no lee audit_log');

-- Escrituras permitidas
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-02-28', 800) $$,
  'custodio: carga medición de su KPI');
select lives_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_total)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-Q2', 2100) $$,
  'custodio: crea compromiso de su KPI');
select lives_ok($$ update public.commitments set notes = 'negociado' where id = 'dddddddd-0000-4000-8000-000000000001' $$, 'custodio: actualiza compromiso de su KPI');
select is((select notes from public.commitments where id = 'dddddddd-0000-4000-8000-000000000001'), 'negociado', 'custodio: la actualización se aplicó');

-- Escrituras prohibidas
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', '2027-02-28', 99) $$,
  '42501', null, 'custodio: no carga mediciones de otro KPI');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', '2027-Q2') $$,
  '42501', null, 'custodio: no crea compromisos de otro KPI');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-02-28', 1, 'aaaaaaaa-0000-4000-8000-000000000003') $$,
  '42501', null, 'custodio: no suplanta a otro usuario en created_by');
select throws_ok(
  $$ update public.measurements set indicator_id = 'cccccccc-0000-4000-8000-000000000002' where id = 'eeeeeeee-0000-4000-8000-000000000001' $$,
  '42501', null, 'custodio: no mueve una medición a otro KPI');
select throws_ok($$ delete from public.measurements where id = 'eeeeeeee-0000-4000-8000-000000000001' $$, '42501', null, 'custodio: no borra mediciones');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-04', 1) $$,
  '42501', null, 'custodio: no crea metas');
select throws_ok(
  $$ insert into public.user_roles (user_id, role) values ('aaaaaaaa-0000-4000-8000-000000000002', 'kpi_manager') $$,
  '42501', null, 'custodio: no se asigna rol de gestora');
select throws_ok(
  $$ insert into public.exceptions (unit_id, reason, expires_on, approved_by)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'x', '2027-03-01', 'aaaaaaaa-0000-4000-8000-000000000002') $$,
  '42501', null, 'custodio: no crea excepciones');

-- Actualizaciones silenciosamente filtradas por RLS (0 filas)
update public.commitments set notes = 'hackeado' where id = 'dddddddd-0000-4000-8000-000000000003';
update public.user_roles set indicator_id = 'cccccccc-0000-4000-8000-000000000002' where user_id = 'aaaaaaaa-0000-4000-8000-000000000002';
reset role;
select is((select notes from public.commitments where id = 'dddddddd-0000-4000-8000-000000000003'), 'orig', 'custodio: no modifica compromisos de otro KPI');
select is((select indicator_id from public.user_roles where user_id = 'aaaaaaaa-0000-4000-8000-000000000002'), 'cccccccc-0000-4000-8000-000000000001'::uuid, 'custodio: no se cambia su propio rol');

select * from finish();
rollback;
