-- F-04: RLS para el líder de unidad (unit_leader). El usuario de prueba
-- lidera FX Unidad 1 (bbbbbbbb-...-01); FX Unidad 2 es de otro líder.
-- Debe: ver solo su unidad; ver indicadores; leer sus alertas y marcarlas
-- leídas. No debe: ver otra unidad ni escribir nada más.
begin;
select plan(25);

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
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000005","role":"authenticated"}';

-- Su unidad
select is((select count(*)::int from public.units), 1, 'líder: ve exactamente una unidad');
select is((select id from public.units), 'bbbbbbbb-0000-4000-8000-000000000001'::uuid, 'líder: la unidad visible es la suya');
select is((select count(*)::int from public.measurements where unit_id = 'bbbbbbbb-0000-4000-8000-000000000001'), 2, 'líder: ve mediciones de su unidad');
select is((select count(*)::int from public.commitments where unit_id = 'bbbbbbbb-0000-4000-8000-000000000001'), 2, 'líder: ve compromisos de su unidad');
select is((select count(*)::int from public.targets where unit_id = 'bbbbbbbb-0000-4000-8000-000000000001'), 1, 'líder: ve metas de su unidad');
select is((select count(*)::int from public.evaluations where unit_id = 'bbbbbbbb-0000-4000-8000-000000000001'), 2, 'líder: ve evaluaciones de su unidad');
select is((select count(*)::int from public.exceptions where unit_id = 'bbbbbbbb-0000-4000-8000-000000000001'), 1, 'líder: ve excepciones de su unidad');
select is((select count(*)::int from public.indicators where id::text like 'cccccccc-%'), 2, 'líder: ve los indicadores');
select is((select count(*)::int from public.alerts), 1, 'líder: ve solo sus alertas');
select is((select count(*)::int from public.user_roles), 1, 'líder: solo ve su propio rol');

-- Otra unidad: 0 filas
select is((select count(*)::int from public.measurements where unit_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 0, 'líder: no ve mediciones de otra unidad');
select is((select count(*)::int from public.commitments where unit_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 0, 'líder: no ve compromisos de otra unidad');
select is((select count(*)::int from public.targets where unit_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 0, 'líder: no ve metas de otra unidad');
select is((select count(*)::int from public.evaluations where unit_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 0, 'líder: no ve evaluaciones de otra unidad');
select is((select count(*)::int from public.exceptions where unit_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 0, 'líder: no ve excepciones de otra unidad');
select is_empty('select 1 from public.audit_log', 'líder: no lee audit_log');

-- Alertas propias: solo read_at
select lives_ok($$ update public.alerts set read_at = now() where id = '77777777-0000-4000-8000-000000000001' $$, 'líder: marca leída su alerta');
select ok((select read_at is not null from public.alerts where id = '77777777-0000-4000-8000-000000000001'), 'líder: read_at quedó registrado');
select throws_ok($$ update public.alerts set kind = 'x' where id = '77777777-0000-4000-8000-000000000001' $$, '42501', null, 'líder: no cambia otras columnas de la alerta');

-- Escrituras prohibidas
select throws_ok(
  $$ insert into public.exceptions (unit_id, reason, expires_on, approved_by)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'me lo apruebo', '2027-03-31', 'aaaaaaaa-0000-4000-8000-000000000005') $$,
  '42501', null, 'líder: no crea excepciones');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-02-01', 9999, 'aaaaaaaa-0000-4000-8000-000000000005') $$,
  '42501', null, 'líder: no carga mediciones');
select throws_ok(
  $$ insert into public.user_roles (user_id, role) values ('aaaaaaaa-0000-4000-8000-000000000005', 'committee') $$,
  '42501', null, 'líder: no se asigna otro rol');

-- Filtrados por RLS (0 filas afectadas)
update public.alerts set read_at = now() where id = '77777777-0000-4000-8000-000000000002';
update public.user_roles set unit_id = 'bbbbbbbb-0000-4000-8000-000000000002' where user_id = 'aaaaaaaa-0000-4000-8000-000000000005';
update public.units set name = 'hackeada' where id = 'bbbbbbbb-0000-4000-8000-000000000001';
reset role;
select is((select read_at from public.alerts where id = '77777777-0000-4000-8000-000000000002'), null::timestamptz, 'líder: no marca alertas ajenas');
select is((select unit_id from public.user_roles where user_id = 'aaaaaaaa-0000-4000-8000-000000000005'), 'bbbbbbbb-0000-4000-8000-000000000001'::uuid, 'líder: no se cambia de unidad');
select is((select name from public.units where id = 'bbbbbbbb-0000-4000-8000-000000000001'), 'FX Unidad 1', 'líder: no renombra su unidad');

select * from finish();
rollback;
