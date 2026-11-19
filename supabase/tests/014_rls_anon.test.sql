-- F-04: anónimo (sin sesión) y usuario autenticado sin rol de negocio.
-- anon no tiene privilegios sobre ninguna tabla; un usuario sin rol no ve nada.
begin;
select plan(17);

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

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok('select * from public.units', '42501', null, 'anon: no lee units');
select throws_ok('select * from public.user_roles', '42501', null, 'anon: no lee user_roles');
select throws_ok('select * from public.indicators', '42501', null, 'anon: no lee indicators');
select throws_ok('select * from public.commitments', '42501', null, 'anon: no lee commitments');
select throws_ok('select * from public.measurements', '42501', null, 'anon: no lee measurements');
select throws_ok('select * from public.targets', '42501', null, 'anon: no lee targets');
select throws_ok('select * from public.evaluations', '42501', null, 'anon: no lee evaluations');
select throws_ok('select * from public.exceptions', '42501', null, 'anon: no lee exceptions');
select throws_ok('select * from public.alerts', '42501', null, 'anon: no lee alerts');
select throws_ok('select * from public.audit_log', '42501', null, 'anon: no lee audit_log');
select throws_ok($$ insert into public.units (name) values ('anon') $$, '42501', null, 'anon: no inserta units');
select throws_ok($$ select private.has_role('kpi_manager') $$, '42501', null, 'anon: no ejecuta funciones de private');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000007","role":"authenticated"}';

select is((select count(*)::int from public.units), 0, 'sin rol: no ve unidades');
select is((select count(*)::int from public.indicators), 0, 'sin rol: no ve indicadores');
select is((select count(*)::int from public.measurements), 0, 'sin rol: no ve mediciones');
select is((select count(*)::int from public.user_roles), 0, 'sin rol: no tiene roles');
select throws_ok($$ insert into public.user_roles (user_id, role) values ('aaaaaaaa-0000-4000-8000-000000000007', 'kpi_manager') $$, '42501', null, 'sin rol: no se autoasigna rol');

select * from finish();
rollback;
