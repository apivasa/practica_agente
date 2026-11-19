-- Seguridad (F-03+F-04+F-06), categoría 1: escalada de privilegios, IDOR y
-- claims manipulados. Pruebas de ataque complementarias a 010-014.
-- Fixture propio con prefijo 5ec… para no chocar con el seed ni con 010-020.
begin;
select plan(35);

insert into auth.users (id, email, aud, role) values
  ('5ec00000-0000-4000-8000-000000000001', 'sec-gestora@example.test',  'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000002', 'sec-custodio1@example.test', 'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000003', 'sec-custodio2@example.test', 'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000004', 'sec-comite1@example.test',  'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000005', 'sec-lider1@example.test',   'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000006', 'sec-lider2@example.test',   'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000007', 'sec-sinrol@example.test',   'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000008', 'sec-comite2@example.test',  'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('5ec10000-0000-4000-8000-000000000001', 'SEC Unidad A', '5ec00000-0000-4000-8000-000000000005'),
  ('5ec10000-0000-4000-8000-000000000002', 'SEC Unidad B', '5ec00000-0000-4000-8000-000000000006');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, custodian_user_id) values
  ('5ec20000-0000-4000-8000-000000000001', 'SEC_X', 'SEC KPI X', 'cumulative_target', 'higher_is_better', 96, 90, '5ec00000-0000-4000-8000-000000000002'),
  ('5ec20000-0000-4000-8000-000000000002', 'SEC_Y', 'SEC KPI Y', 'window_average',    'higher_is_better', 99.9, 99.5, '5ec00000-0000-4000-8000-000000000003');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec00000-0000-4000-8000-000000000001', 'kpi_manager', null, null),
  ('5ec00000-0000-4000-8000-000000000002', 'custodian',   null, '5ec20000-0000-4000-8000-000000000001'),
  ('5ec00000-0000-4000-8000-000000000003', 'custodian',   null, '5ec20000-0000-4000-8000-000000000002'),
  ('5ec00000-0000-4000-8000-000000000004', 'committee',   null, null),
  ('5ec00000-0000-4000-8000-000000000008', 'committee',   null, null),
  ('5ec00000-0000-4000-8000-000000000005', 'unit_leader', '5ec10000-0000-4000-8000-000000000001', null),
  ('5ec00000-0000-4000-8000-000000000006', 'unit_leader', '5ec10000-0000-4000-8000-000000000002', null);
insert into public.measurements (id, unit_id, indicator_id, measured_on, value, created_by) values
  ('5ec30000-0000-4000-8000-000000000001', '5ec10000-0000-4000-8000-000000000001', '5ec20000-0000-4000-8000-000000000001', '2027-01-31', 400, '5ec00000-0000-4000-8000-000000000002'),
  ('5ec30000-0000-4000-8000-000000000002', '5ec10000-0000-4000-8000-000000000002', '5ec20000-0000-4000-8000-000000000002', '2027-01-15', 99.1, '5ec00000-0000-4000-8000-000000000003');
insert into public.commitments (id, unit_id, indicator_id, period, package_total, notes, created_by) values
  ('5ec40000-0000-4000-8000-000000000001', '5ec10000-0000-4000-8000-000000000001', '5ec20000-0000-4000-8000-000000000001', '2027-Q1', 2000, 'orig', '5ec00000-0000-4000-8000-000000000002'),
  ('5ec40000-0000-4000-8000-000000000002', '5ec10000-0000-4000-8000-000000000002', '5ec20000-0000-4000-8000-000000000002', '2027-Q1', 10, 'orig', '5ec00000-0000-4000-8000-000000000003');
insert into public.targets (id, unit_id, indicator_id, month, target_value) values
  ('5ec50000-0000-4000-8000-000000000001', '5ec10000-0000-4000-8000-000000000001', '5ec20000-0000-4000-8000-000000000001', '2027-01', 667),
  ('5ec50000-0000-4000-8000-000000000002', '5ec10000-0000-4000-8000-000000000002', '5ec20000-0000-4000-8000-000000000001', '2027-01', 500);
insert into public.evaluations (id, unit_id, indicator_id, month, color, sample_size) values
  ('5ec60000-0000-4000-8000-000000000001', '5ec10000-0000-4000-8000-000000000001', null, '2027-01', 'red', 0),
  ('5ec60000-0000-4000-8000-000000000002', '5ec10000-0000-4000-8000-000000000002', null, '2027-01', 'red', 0);
insert into public.exceptions (id, unit_id, scope, reason, expires_on, approved_by) values
  ('5ec70000-0000-4000-8000-000000000001', '5ec10000-0000-4000-8000-000000000001', 'all', 'SEC urgente A', current_date + 30, '5ec00000-0000-4000-8000-000000000004'),
  ('5ec70000-0000-4000-8000-000000000002', '5ec10000-0000-4000-8000-000000000002', 'all', 'SEC urgente B', current_date + 30, '5ec00000-0000-4000-8000-000000000004');
insert into public.alerts (id, unit_id, recipient_user_id, kind, payload) values
  ('5ec80000-0000-4000-8000-000000000001', '5ec10000-0000-4000-8000-000000000001', '5ec00000-0000-4000-8000-000000000005', 'color_change', '{}'),
  ('5ec80000-0000-4000-8000-000000000002', '5ec10000-0000-4000-8000-000000000002', '5ec00000-0000-4000-8000-000000000006', 'color_change', '{}');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- 1. Claims manipulados: el rol de BD manda, no el claim `role`.
--    Un JWT con "role":"service_role" que llegara como `authenticated`
--    (p. ej. claims inyectados en una sesión) no salta RLS.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000007","role":"service_role"}';
select is((select count(*)::int from public.user_roles), 0, 'claim role=service_role + rol BD authenticated: no ve user_roles');
select is((select count(*)::int from public.exceptions), 0, 'claim role=service_role: no ve excepciones');
select throws_ok(
  $$ insert into public.user_roles (user_id, role) values ('5ec00000-0000-4000-8000-000000000007', 'kpi_manager') $$,
  '42501', null, 'claim role=service_role: no se autoasigna gestora');
select throws_ok(
  $$ insert into public.evaluations (unit_id, month, color) values ('5ec10000-0000-4000-8000-000000000001', '2027-01', 'green') $$,
  '42501', null, 'claim role=service_role: no escribe evaluaciones');

-- Claims con app_metadata/user_role inventados no dan rol (la autorización
-- sale de public.user_roles, no del JWT).
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000007","role":"authenticated","app_metadata":{"role":"kpi_manager"},"user_role":"committee"}';
select is((select count(*)::int from public.units where id::text like '5ec1%'), 0, 'claims app_metadata.role inventados: no ve unidades');
select throws_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, expires_on) values ('5ec10000-0000-4000-8000-000000000001', 'all', 'x', current_date + 30) $$,
  '42501', null, 'claims user_role=committee inventados: no aprueba excepciones');

-- JWT sin sub (p. ej. clave publicable sin sesión pero rol authenticated)
set local request.jwt.claims = '{"role":"authenticated"}';
select is((select count(*)::int from public.measurements where id::text like '5ec3%'), 0, 'JWT sin sub: no ve mediciones');
select is((select count(*)::int from public.alerts where id::text like '5ec8%'), 0, 'JWT sin sub: no ve alertas (recipient = null)');

-- ---------------------------------------------------------------------------
-- 2. Usuario autenticado sin rol de negocio (registro abierto en Auth)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000007","role":"authenticated"}';
select is((select count(*)::int from public.indicators where id::text like '5ec2%'), 0, 'sin rol: no ve indicadores');
select is((select count(*)::int from public.targets where id::text like '5ec5%'), 0, 'sin rol: no ve metas');
select is((select count(*)::int from public.evaluations where id::text like '5ec6%'), 0, 'sin rol: no ve evaluaciones');
select throws_ok(
  $$ insert into public.user_roles (user_id, role, unit_id) values ('5ec00000-0000-4000-8000-000000000007', 'unit_leader', '5ec10000-0000-4000-8000-000000000002') $$,
  '42501', null, 'sin rol: no se hace líder de una unidad');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value) values ('5ec10000-0000-4000-8000-000000000001', '5ec20000-0000-4000-8000-000000000001', '2027-02-01', 1) $$,
  '42501', null, 'sin rol: no carga mediciones');

-- ---------------------------------------------------------------------------
-- 3. Líder: escalada e IDOR
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000005","role":"authenticated"}';
with u as (update public.user_roles set unit_id = '5ec10000-0000-4000-8000-000000000002' where user_id = auth.uid() returning 1)
select is(count(*)::int, 0, 'líder: no se cambia de unidad en su propia fila') from u;
with u as (update public.user_roles set role = 'committee', unit_id = null where user_id = auth.uid() returning 1)
select is(count(*)::int, 0, 'líder: no se cambia el rol a comité') from u;
with u as (update public.units set leader_user_id = auth.uid() where id = '5ec10000-0000-4000-8000-000000000002' returning 1)
select is(count(*)::int, 0, 'líder: no se apropia de otra unidad vía units.leader_user_id') from u;
with u as (update public.exceptions set expires_on = current_date + 60 where id = '5ec70000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 0, 'líder: no extiende la excepción de su unidad') from u;
select throws_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, expires_on, approved_by) values ('5ec10000-0000-4000-8000-000000000001', 'all', 'auto', current_date + 30, '5ec00000-0000-4000-8000-000000000004') $$,
  '42501', null, 'líder: no crea excepción suplantando al comité');
select throws_ok(
  $$ update public.evaluations set color = 'green' where unit_id = '5ec10000-0000-4000-8000-000000000001' $$,
  '42501', null, 'líder: no se pinta de verde (sin privilegio UPDATE)');
-- IDOR con filtros tipo PostgREST (or=, in=) hacia la unidad B
select is((select count(*)::int from public.measurements
           where unit_id = '5ec10000-0000-4000-8000-000000000002' or id = '5ec30000-0000-4000-8000-000000000002'), 0,
  'líder: or= hacia la unidad B no devuelve mediciones');
select is((select count(*)::int from public.alerts
           where id in ('5ec80000-0000-4000-8000-000000000001', '5ec80000-0000-4000-8000-000000000002')), 1,
  'líder: in= con ids de alertas ajenas solo devuelve la suya');
select is((select count(*)::int from public.units u join public.evaluations e on e.unit_id = u.id), 1,
  'líder: join units-evaluations no filtra datos de otra unidad');

-- ---------------------------------------------------------------------------
-- 4. Custodio de X contra el KPI Y
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000002","role":"authenticated"}';
with u as (update public.measurements set value = 0 where id = '5ec30000-0000-4000-8000-000000000002' returning 1)
select is(count(*)::int, 0, 'custodio X: no modifica mediciones del KPI Y') from u;
with u as (update public.commitments set package_total = 1 where id = '5ec40000-0000-4000-8000-000000000002' returning 1)
select is(count(*)::int, 0, 'custodio X: no modifica compromisos del KPI Y') from u;
select throws_ok(
  $$ update public.commitments set indicator_id = '5ec20000-0000-4000-8000-000000000002' where id = '5ec40000-0000-4000-8000-000000000001' $$,
  '42501', null, 'custodio X: no mueve un compromiso al KPI Y');
with u as (update public.user_roles set indicator_id = '5ec20000-0000-4000-8000-000000000002' where user_id = auth.uid() returning 1)
select is(count(*)::int, 0, 'custodio X: no se reasigna al KPI Y') from u;
with u as (update public.indicators set green_threshold = 0, yellow_threshold = 0 where id = '5ec20000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 0, 'custodio X: no relaja los umbrales de su propio KPI') from u;

-- ---------------------------------------------------------------------------
-- 5. Comité: approved_by no se puede atribuir a otro
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000008","role":"authenticated"}';
select throws_ok(
  $$ update public.exceptions set approved_by = '5ec00000-0000-4000-8000-000000000001' where id = '5ec70000-0000-4000-8000-000000000001' $$,
  '42501', null, 'comité: no atribuye la aprobación a otro usuario');
select throws_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, expires_on, approved_by) values ('5ec10000-0000-4000-8000-000000000002', 'all', 'x', current_date + 30, '5ec00000-0000-4000-8000-000000000004') $$,
  '42501', null, 'comité: no aprueba a nombre de otro miembro');
select throws_ok(
  $$ update public.exceptions set reason = 'editado' where id = '5ec70000-0000-4000-8000-000000000001' $$,
  '42501', null, 'comité: no edita en silencio una excepción aprobada por otro manteniendo su firma');

-- ---------------------------------------------------------------------------
-- 6. Gestora: no aprueba excepciones ni escribe datos del backend
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ insert into public.exceptions (unit_id, scope, reason, expires_on) values ('5ec10000-0000-4000-8000-000000000001', 'all', 'x', current_date + 30) $$,
  '42501', null, 'gestora: no aprueba excepciones');
with u as (update public.exceptions set expires_on = current_date + 60 where id = '5ec70000-0000-4000-8000-000000000002' returning 1)
select is(count(*)::int, 0, 'gestora: no extiende excepciones') from u;
select throws_ok(
  $$ insert into public.alerts (recipient_user_id, kind) values ('5ec00000-0000-4000-8000-000000000005', 'fake') $$,
  '42501', null, 'gestora: no inserta alertas');
select throws_ok(
  $$ update public.evaluations set color = 'green' $$,
  '42501', null, 'gestora: no reescribe evaluaciones');

reset role;
select is((select unit_id from public.user_roles where user_id = '5ec00000-0000-4000-8000-000000000005'),
  '5ec10000-0000-4000-8000-000000000001'::uuid, 'estado final: el líder sigue en su unidad');

select * from finish();
rollback;
