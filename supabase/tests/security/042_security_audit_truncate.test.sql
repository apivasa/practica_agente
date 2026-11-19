-- Seguridad (F-03+F-04+F-06), categorías 1 y 8: TRUNCATE, inserción en
-- tablas del backend, actor de auditoría no falsificable e inmutabilidad.
begin;
select plan(20);

insert into auth.users (id, email, aud, role) values
  ('5ec00000-0000-4000-8000-0000000000a1', 'sec2-gestora@example.test',  'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000000a2', 'sec2-custodio@example.test', 'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000000a3', 'sec2-otro@example.test',     'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000000a4', 'sec2-comite@example.test',   'authenticated', 'authenticated');
insert into public.units (id, name) values ('5ec10000-0000-4000-8000-0000000000a1', 'SEC2 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('5ec20000-0000-4000-8000-0000000000a1', 'SEC2_X', 'SEC2 KPI', 'cumulative_target', 'higher_is_better', 96, 90);
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec00000-0000-4000-8000-0000000000a1', 'kpi_manager', null, null),
  ('5ec00000-0000-4000-8000-0000000000a2', 'custodian', null, '5ec20000-0000-4000-8000-0000000000a1'),
  ('5ec00000-0000-4000-8000-0000000000a4', 'committee', null, null);
insert into public.commitments (id, unit_id, indicator_id, period, package_total, created_by) values
  ('5ec40000-0000-4000-8000-0000000000a1', '5ec10000-0000-4000-8000-0000000000a1', '5ec20000-0000-4000-8000-0000000000a1', '2027-Q1', 100, '5ec00000-0000-4000-8000-0000000000a2');

-- ---------------------------------------------------------------------------
-- TRUNCATE (ignora RLS): denegado a anon y a authenticated con cualquier rol.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ truncate public.measurements $$, '42501', null, 'anon: TRUNCATE measurements denegado');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'anon: TRUNCATE audit_log denegado');
select throws_ok($$ select * from public.units $$, '42501', null, 'anon: SELECT units denegado por privilegio');
select throws_ok($$ select private.has_role('kpi_manager') $$, '42501', null, 'anon: no invoca funciones de private');

set local role authenticated;
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$ truncate public.user_roles $$, '42501', null, 'gestora: TRUNCATE user_roles denegado');
select throws_ok($$ truncate public.audit_log $$, '42501', null, 'gestora: TRUNCATE audit_log denegado');
select throws_ok($$ truncate public.exceptions cascade $$, '42501', null, 'gestora: TRUNCATE exceptions denegado');
select throws_ok($$ select nextval('public.audit_log_id_seq') $$, '42501', null, 'gestora: no consume la secuencia de audit_log');
select throws_ok($$ select private.audit_row_change() $$, '42501', null, 'gestora: no invoca la función de auditoría');
select throws_ok(
  $$ insert into public.audit_log (actor, action, entity) values ('5ec00000-0000-4000-8000-0000000000a4', 'approve', 'exceptions') $$,
  '42501', null, 'gestora: no fabrica entradas de auditoría a nombre del comité');

-- ---------------------------------------------------------------------------
-- Actor no falsificable: sale de auth.uid(), no de created_by/approved_by.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000000a2","role":"authenticated"}';
update public.commitments set notes = 'cambio auditado' where id = '5ec40000-0000-4000-8000-0000000000a1';
select throws_ok($$ truncate public.commitments $$, '42501', null, 'custodio: TRUNCATE commitments denegado');
select throws_ok($$ update public.audit_log set actor = 'nadie' $$, '42501', null, 'custodio: no modifica auditoría');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'custodio: no borra auditoría');

set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ insert into public.exceptions (id, unit_id, scope, reason, expires_on) values ('5ec70000-0000-4000-8000-0000000000a1', '5ec10000-0000-4000-8000-0000000000a1', 'all', 'SEC2 aud', '2027-03-31') $$,
  'comité: aprueba excepción (para auditar)');
select is(
  (select count(*)::int from public.audit_log where entity = 'exceptions' and entity_id = '5ec70000-0000-4000-8000-0000000000a1'
     and actor = '5ec00000-0000-4000-8000-0000000000a4'),
  1, 'comité: la auditoría que lee registra su uid como actor');
select throws_ok($$ update public.audit_log set details = '{}' where entity_id = '5ec70000-0000-4000-8000-0000000000a1' $$, '42501', null, 'comité: no modifica auditoría');

reset role;
select is(
  (select actor from public.audit_log where entity = 'commitments' and entity_id = '5ec40000-0000-4000-8000-0000000000a1' and action = 'update'),
  '5ec00000-0000-4000-8000-0000000000a2', 'auditoría: actor del update = uid del JWT del custodio');
select is(
  (select count(*)::int from public.audit_log where entity = 'exceptions' and entity_id = '5ec70000-0000-4000-8000-0000000000a1'),
  1, 'auditoría: la excepción sigue auditada tras los intentos de borrado');

-- Sin JWT (backend/sesión directa): el actor queda como system:<rol de sesión>, nunca vacío.
set local request.jwt.claims = '';
update public.indicators set yellow_threshold = 91 where id = '5ec20000-0000-4000-8000-0000000000a1';
select matches(
  (select actor from public.audit_log where entity = 'indicators' and entity_id = '5ec20000-0000-4000-8000-0000000000a1' and action = 'update'),
  '^system:.+', 'auditoría: sin JWT el actor es system:<sesión>');

-- FK a auth.users: borrar un usuario no borra su rastro en auditoría.
delete from auth.users where id = '5ec00000-0000-4000-8000-0000000000a4';
select is(
  (select count(*)::int from public.audit_log where entity = 'exceptions' and entity_id = '5ec70000-0000-4000-8000-0000000000a1'
     and actor = '5ec00000-0000-4000-8000-0000000000a4' and action = 'insert'),
  1, 'auditoría: el alta firmada por el comité sobrevive al borrado del usuario');

select * from finish();
rollback;
