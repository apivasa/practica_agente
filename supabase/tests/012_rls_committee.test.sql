-- F-04: RLS para el comité de delivery (committee).
-- Debe: leer todo (incluida auditoría); crear y actualizar excepciones como
-- aprobador. No debe: borrar excepciones, configurar, cargar datos ni
-- escribir evaluaciones o alertas.
begin;
select plan(22);

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
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000004","role":"authenticated"}';

-- Lecturas
select is((select count(*)::int from public.units where id::text like 'bbbbbbbb-%'), 2, 'comité: ve todas las unidades');
select is((select count(*)::int from public.measurements where id::text like 'eeeeeeee-%'), 4, 'comité: ve todas las mediciones');
select is((select count(*)::int from public.commitments where id::text like 'dddddddd-%'), 3, 'comité: ve todos los compromisos');
select is((select count(*)::int from public.targets where id::text like 'ffffffff-%'), 2, 'comité: ve todas las metas');
select is((select count(*)::int from public.evaluations where id::text like '99999999-%'), 3, 'comité: ve todas las evaluaciones');
select is((select count(*)::int from public.exceptions where id::text like '88888888-%'), 2, 'comité: ve todas las excepciones');
select is((select count(*)::int from public.alerts where id::text like '77777777-%'), 3, 'comité: ve todas las alertas');
select is((select count(*)::int from public.user_roles where user_id::text like 'aaaaaaaa-%'), 6, 'comité: ve todos los roles');
select isnt_empty('select 1 from public.audit_log', 'comité: lee audit_log');

-- Excepciones
select lives_ok(
  $$ insert into public.exceptions (id, unit_id, scope, reason, expires_on)
     values ('88888888-0000-4000-8000-000000000009', 'bbbbbbbb-0000-4000-8000-000000000002', 'change_start', 'Arranque urgente', current_date + 30) $$,
  'comité: aprueba excepción (approved_by por defecto = quien aprueba)');
select is((select approved_by from public.exceptions where id = '88888888-0000-4000-8000-000000000009'), 'aaaaaaaa-0000-4000-8000-000000000004'::uuid, 'comité: approved_by queda con su usuario');
select lives_ok($$ update public.exceptions set expires_on = current_date + 45 where id = '88888888-0000-4000-8000-000000000001' $$, 'comité: actualiza excepción');
select throws_ok(
  $$ insert into public.exceptions (unit_id, reason, expires_on, approved_by)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'x', current_date + 30, 'aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501', null, 'comité: no registra excepción a nombre de otro');
select throws_ok($$ delete from public.exceptions where id = '88888888-0000-4000-8000-000000000001' $$, '42501', null, 'comité: no borra excepciones');

-- Escrituras prohibidas
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-02-01', 1, 'aaaaaaaa-0000-4000-8000-000000000004') $$,
  '42501', null, 'comité: no carga mediciones');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_COM', 'x', 'coverage', 'higher_is_better', 90, 75) $$,
  '42501', null, 'comité: no crea indicadores');
select throws_ok(
  $$ insert into public.user_roles (user_id, role) values ('aaaaaaaa-0000-4000-8000-000000000004', 'kpi_manager') $$,
  '42501', null, 'comité: no se asigna rol de gestora');
select throws_ok(
  $$ insert into public.evaluations (unit_id, month, color) values ('bbbbbbbb-0000-4000-8000-000000000001', '2027-02', 'green') $$,
  '42501', null, 'comité: no escribe evaluaciones');
select throws_ok(
  $$ insert into public.alerts (recipient_user_id, kind) values ('aaaaaaaa-0000-4000-8000-000000000004', 'x') $$,
  '42501', null, 'comité: no inserta alertas');

-- Filtrados por RLS (0 filas afectadas)
update public.indicators set green_threshold = 50 where id = 'cccccccc-0000-4000-8000-000000000001';
update public.alerts set read_at = now() where id = '77777777-0000-4000-8000-000000000001';
delete from public.units where id = 'bbbbbbbb-0000-4000-8000-000000000001';
reset role;
select is((select green_threshold from public.indicators where id = 'cccccccc-0000-4000-8000-000000000001'), 96::numeric, 'comité: no cambia umbrales');
select is((select read_at from public.alerts where id = '77777777-0000-4000-8000-000000000001'), null::timestamptz, 'comité: no marca leídas alertas ajenas');
select is((select count(*)::int from public.units where id = 'bbbbbbbb-0000-4000-8000-000000000001'), 1, 'comité: no borra unidades');

select * from finish();
rollback;
