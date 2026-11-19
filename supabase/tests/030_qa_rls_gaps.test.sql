-- QA F-03/F-04/F-06: huecos de RLS frente a docs/diseno.md (Roles, Excepciones,
-- Alertas). Cada bloque traza a una frase del diseño:
--  * Gestora: "define las reglas", pero no aprueba excepciones (eso es del comité)
--    ni carga datos (eso es del custodio).
--  * Custodio: "dueño de un KPI": escribe solo lo de su KPI; no reconfigura el
--    indicador (umbrales son de la gestora); nadie escribe evaluaciones.
--  * Comité: "ve todas las unidades ... aprueba excepciones": lee, no edita datos.
--  * Líder: "ve solo sus indicadores, su color, su meta": lectura de su unidad.
--  * Anónimo y usuario sin rol: nada.
begin;
select plan(46);

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

-- ---------------------------------------------------------------------------
-- Custodio de FX_VULN (…02)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ update public.commitments set indicator_id = 'cccccccc-0000-4000-8000-000000000002' where id = 'dddddddd-0000-4000-8000-000000000001' $$,
  '42501', null, 'custodio: no mueve un compromiso a otro KPI');
select throws_ok(
  $$ insert into public.evaluations (unit_id, indicator_id, month, color) values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-02', 'green') $$,
  '42501', null, 'custodio: no escribe evaluaciones ni de su KPI');
select throws_ok($$ update public.evaluations set color = 'green' where id = '99999999-0000-4000-8000-000000000003' $$, '42501', null, 'custodio: no cambia el color de una evaluación');
select throws_ok($$ delete from public.commitments where id = 'dddddddd-0000-4000-8000-000000000001' $$, '42501', null, 'custodio: no borra compromisos');
select throws_ok($$ insert into public.alerts (recipient_user_id, kind) values ('aaaaaaaa-0000-4000-8000-000000000005', 'x') $$, '42501', null, 'custodio: no inserta alertas');
-- Filtrados por RLS (se verifican al final como postgres)
update public.measurements set value = 1 where id = 'eeeeeeee-0000-4000-8000-000000000003';
update public.indicators set green_threshold = 1, yellow_threshold = 0 where id = 'cccccccc-0000-4000-8000-000000000001';
delete from public.indicators where id = 'cccccccc-0000-4000-8000-000000000001';
update public.targets set target_value = 1 where id = 'ffffffff-0000-4000-8000-000000000001';
update public.exceptions set expires_on = '2099-12-31' where id = '88888888-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Líder de FX Unidad 1 (…05)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.alerts where id = '77777777-0000-4000-8000-000000000003'), 0, 'líder: no ve alertas de su unidad dirigidas al comité');
select throws_ok(
  $$ insert into public.evaluations (unit_id, month, color) values ('bbbbbbbb-0000-4000-8000-000000000001', '2027-02', 'green') $$,
  '42501', null, 'líder: no escribe evaluaciones de su unidad');
select throws_ok($$ delete from public.exceptions where unit_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$, '42501', null, 'líder: no borra excepciones');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, created_by) values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-Q3', 'aaaaaaaa-0000-4000-8000-000000000005') $$,
  '42501', null, 'líder: no crea compromisos');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value) values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-05', 1) $$,
  '42501', null, 'líder: no crea metas');
select throws_ok($$ insert into public.units (name) values ('FX líder') $$, '42501', null, 'líder: no crea unidades');
update public.exceptions set expires_on = '2099-12-31' where id = '88888888-0000-4000-8000-000000000001';
update public.measurements set value = 0 where id = 'eeeeeeee-0000-4000-8000-000000000001';
update public.commitments set package_total = 1 where id = 'dddddddd-0000-4000-8000-000000000001';
update public.targets set target_value = 1 where id = 'ffffffff-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Comité (…04)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ update public.evaluations set color = 'green' where id = '99999999-0000-4000-8000-000000000002' $$, '42501', null, 'comité: no cambia el color de una evaluación');
select throws_ok($$ delete from public.evaluations where id = '99999999-0000-4000-8000-000000000002' $$, '42501', null, 'comité: no borra evaluaciones');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, created_by) values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-Q3', 'aaaaaaaa-0000-4000-8000-000000000004') $$,
  '42501', null, 'comité: no crea compromisos');
select throws_ok($$ delete from public.exceptions $$, '42501', null, 'comité: no vacía la tabla de excepciones');
update public.measurements set value = 0 where id = 'eeeeeeee-0000-4000-8000-000000000002';
update public.commitments set package_total = 1 where id = 'dddddddd-0000-4000-8000-000000000002';
update public.targets set target_value = 1 where id = 'ffffffff-0000-4000-8000-000000000002';
update public.user_roles set unit_id = 'bbbbbbbb-0000-4000-8000-000000000002' where user_id = 'aaaaaaaa-0000-4000-8000-000000000005';

-- ---------------------------------------------------------------------------
-- Gestora (…01)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ delete from public.exceptions where id = '88888888-0000-4000-8000-000000000002' $$, '42501', null, 'gestora: no borra excepciones');
select throws_ok($$ update public.evaluations set color = 'green' where id = '99999999-0000-4000-8000-000000000002' $$, '42501', null, 'gestora: no cambia el color de una evaluación');
update public.exceptions set expires_on = '2099-12-31' where id = '88888888-0000-4000-8000-000000000002';
update public.measurements set value = 0 where id = 'eeeeeeee-0000-4000-8000-000000000004';
update public.commitments set package_total = 1 where id = 'dddddddd-0000-4000-8000-000000000003';
update public.alerts set read_at = now() where id = '77777777-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- Usuario autenticado sin rol (…07)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000007","role":"authenticated"}';
select is((select count(*)::int from public.exceptions), 0, 'sin rol: no ve excepciones');
select is((select count(*)::int from public.evaluations), 0, 'sin rol: no ve evaluaciones');
select is((select count(*)::int from public.alerts), 0, 'sin rol: no ve alertas');
select is((select count(*)::int from public.commitments), 0, 'sin rol: no ve compromisos');
select is((select count(*)::int from public.targets), 0, 'sin rol: no ve metas');
select is_empty('select 1 from public.audit_log', 'sin rol: no lee audit_log');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value) values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-02-01', 1) $$,
  '42501', null, 'sin rol: no carga mediciones');
select throws_ok(
  $$ insert into public.exceptions (unit_id, reason, expires_on) values ('bbbbbbbb-0000-4000-8000-000000000001', 'x', '2027-03-01') $$,
  '42501', null, 'sin rol: no crea excepciones');

-- ---------------------------------------------------------------------------
-- Anónimo
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value) values ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', '2027-02-01', 1) $$,
  '42501', null, 'anon: no carga mediciones');
select throws_ok(
  $$ insert into public.exceptions (unit_id, reason, expires_on) values ('bbbbbbbb-0000-4000-8000-000000000001', 'x', '2027-03-01') $$,
  '42501', null, 'anon: no crea excepciones');
select throws_ok($$ update public.evaluations set color = 'green' $$, '42501', null, 'anon: no cambia evaluaciones');
select throws_ok($$ delete from public.user_roles $$, '42501', null, 'anon: no borra roles');
select throws_ok($$ update public.alerts set read_at = now() $$, '42501', null, 'anon: no marca alertas');

-- ---------------------------------------------------------------------------
-- Verificación como postgres de las escrituras filtradas por RLS
-- ---------------------------------------------------------------------------
reset role;
select is((select value from public.measurements where id = 'eeeeeeee-0000-4000-8000-000000000003'), 99.95::numeric, 'custodio: no modifica mediciones de otro KPI');
select is((select green_threshold from public.indicators where id = 'cccccccc-0000-4000-8000-000000000001'), 96::numeric, 'custodio: no cambia umbrales ni de su propio KPI');
select is((select count(*)::int from public.indicators where id = 'cccccccc-0000-4000-8000-000000000001'), 1, 'custodio: no borra su indicador');
select is((select target_value from public.targets where id = 'ffffffff-0000-4000-8000-000000000001'), 667::numeric, 'custodio y líder: no modifican metas');
select is((select expires_on from public.exceptions where id = '88888888-0000-4000-8000-000000000001'), '2027-02-28'::date, 'custodio y líder: no extienden excepciones');
select is((select value from public.measurements where id = 'eeeeeeee-0000-4000-8000-000000000001'), 400::numeric, 'líder: no modifica mediciones de su unidad');
select is((select package_total from public.commitments where id = 'dddddddd-0000-4000-8000-000000000001'), 2000::numeric, 'líder: no modifica compromisos de su unidad');
select is((select value from public.measurements where id = 'eeeeeeee-0000-4000-8000-000000000002'), 300::numeric, 'comité: no modifica mediciones');
select is((select package_total from public.commitments where id = 'dddddddd-0000-4000-8000-000000000002'), 1500::numeric, 'comité: no modifica compromisos');
select is((select target_value from public.targets where id = 'ffffffff-0000-4000-8000-000000000002'), 500::numeric, 'comité: no modifica metas');
select is((select unit_id from public.user_roles where user_id = 'aaaaaaaa-0000-4000-8000-000000000005'), 'bbbbbbbb-0000-4000-8000-000000000001'::uuid, 'comité: no reasigna roles');
select is((select expires_on from public.exceptions where id = '88888888-0000-4000-8000-000000000002'), '2027-02-28'::date, 'gestora: no extiende excepciones');
select is((select value from public.measurements where id = 'eeeeeeee-0000-4000-8000-000000000004'), 99.10::numeric, 'gestora: no modifica mediciones');
select is((select package_total from public.commitments where id = 'dddddddd-0000-4000-8000-000000000003'), null::numeric, 'gestora: no modifica compromisos');
select is((select read_at from public.alerts where id = '77777777-0000-4000-8000-000000000002'), null::timestamptz, 'gestora: no marca leídas alertas ajenas');
select is((select count(*)::int from public.evaluations where id::text like '99999999-%'), 3, 'nadie borró evaluaciones');

select * from finish();
rollback;
