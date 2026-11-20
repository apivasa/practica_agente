-- Seguridad (M-07), categoría 1 y 8: la pantalla #/gestora/metas escribe
-- `targets`. Pentest de RLS por rol sobre exactamente las operaciones que usa
-- src/data/target-admin.js (select por (unidad, indicador, mes) y luego
-- insert o update de target_value), más IDOR del líder, filas sin cambios
-- parciales y auditoría de la escritura de la gestora.
begin;
select plan(22);

insert into auth.users (id, email, aud, role) values
  ('5ec00000-0000-4000-8000-0000000007a1', 'sec-m07-gestora@example.test',  'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000007a2', 'sec-m07-custodio@example.test', 'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000007a3', 'sec-m07-comite@example.test',   'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000007a4', 'sec-m07-lider-a@example.test',  'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000007a5', 'sec-m07-sinrol@example.test',   'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('5ec10000-0000-4000-8000-0000000007a1', 'SEC M07 Unidad A', '5ec00000-0000-4000-8000-0000000007a4'),
  ('5ec10000-0000-4000-8000-0000000007a2', 'SEC M07 Unidad B', null);
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, custodian_user_id) values
  ('5ec20000-0000-4000-8000-0000000007a1', 'SEC_M07', 'SEC M07 indicador', 'window_average', 'higher_is_better', 2, 1,
   '5ec00000-0000-4000-8000-0000000007a2');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec00000-0000-4000-8000-0000000007a1', 'kpi_manager', null, null),
  ('5ec00000-0000-4000-8000-0000000007a2', 'custodian',   null, '5ec20000-0000-4000-8000-0000000007a1'),
  ('5ec00000-0000-4000-8000-0000000007a3', 'committee',   null, null),
  ('5ec00000-0000-4000-8000-0000000007a4', 'unit_leader', '5ec10000-0000-4000-8000-0000000007a1', null);
insert into public.targets (id, unit_id, indicator_id, month, target_value) values
  ('5ec30000-0000-4000-8000-0000000007a1', '5ec10000-0000-4000-8000-0000000007a1', '5ec20000-0000-4000-8000-0000000007a1', '2031-01', 10),
  ('5ec30000-0000-4000-8000-0000000007a2', '5ec10000-0000-4000-8000-0000000007a2', '5ec20000-0000-4000-8000-0000000007a1', '2031-01', 20);

-- Anónimo: sin privilegios de tabla.
select ok(not has_table_privilege('anon', 'public.targets', 'SELECT')
          and not has_table_privilege('anon', 'public.targets', 'INSERT')
          and not has_table_privilege('anon', 'public.targets', 'UPDATE'),
  'anon: sin SELECT/INSERT/UPDATE en targets');
select ok(not has_table_privilege('authenticated', 'public.targets', 'TRUNCATE'),
  'authenticated: sin TRUNCATE en targets (ignora RLS)');

set local role authenticated;

-- Custodio: lee, no escribe.
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000007a2","role":"authenticated"}';
select is((select count(*)::int from public.targets where id::text like '5ec30000-%'), 2, 'custodio: lee las metas');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-0000000007a1', '5ec20000-0000-4000-8000-0000000007a1', '2031-02', 1) $$,
  '42501', null, 'custodio: no crea metas (ni de su propio KPI)');
update public.targets set target_value = 0 where id = '5ec30000-0000-4000-8000-0000000007a1';
delete from public.targets where id = '5ec30000-0000-4000-8000-0000000007a1';

-- Comité: lee, no escribe.
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000007a3","role":"authenticated"}';
select is((select count(*)::int from public.targets where id::text like '5ec30000-%'), 2, 'comité: lee las metas');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-0000000007a2', '5ec20000-0000-4000-8000-0000000007a1', '2031-02', 1) $$,
  '42501', null, 'comité: no crea metas');
update public.targets set target_value = 0 where id::text like '5ec30000-%';
delete from public.targets where id::text like '5ec30000-%';

-- Líder A: solo su unidad; IDOR por id, por filtro y por or= no fuga B.
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000007a4","role":"authenticated"}';
select is((select count(*)::int from public.targets where id::text like '5ec30000-%'), 1, 'líder A: ve solo una meta');
select is((select count(*)::int from public.targets where id = '5ec30000-0000-4000-8000-0000000007a2'), 0,
  'líder A: IDOR por id de la meta de B devuelve 0 filas');
select is((select count(*)::int from public.targets
            where unit_id = '5ec10000-0000-4000-8000-0000000007a1' or unit_id = '5ec10000-0000-4000-8000-0000000007a2'), 1,
  'líder A: filtro or= con la unidad B no fuga');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-0000000007a1', '5ec20000-0000-4000-8000-0000000007a1', '2031-02', 1) $$,
  '42501', null, 'líder A: no crea la meta de su propia unidad');
update public.targets set target_value = 0 where id = '5ec30000-0000-4000-8000-0000000007a1';
update public.targets set unit_id = '5ec10000-0000-4000-8000-0000000007a1' where id = '5ec30000-0000-4000-8000-0000000007a2';

-- Usuario autenticado sin rol: nada.
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000007a5","role":"authenticated"}';
select is((select count(*)::int from public.targets where id::text like '5ec30000-%'), 0, 'sin rol: no ve metas');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-0000000007a1', '5ec20000-0000-4000-8000-0000000007a1', '2031-03', 1) $$,
  '42501', null, 'sin rol: no crea metas');

-- Nadie salvo la gestora cambió nada.
reset role;
select is((select array_agg(target_value::int order by id) from public.targets where id::text like '5ec30000-%'),
  array[10, 20], 'custodio, comité, líder y sin rol: no modifican ni borran metas');
select is((select unit_id from public.targets where id = '5ec30000-0000-4000-8000-0000000007a2'),
  '5ec10000-0000-4000-8000-0000000007a2'::uuid, 'líder A: no se apropia de la meta de B cambiando unit_id');

-- Gestora: el flujo de target-admin.js (insert y update de target_value) pasa;
-- las reglas de la tabla siguen aplicando aunque el front se salte su validación.
set local role authenticated;
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000007a1","role":"authenticated"}';
select lives_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-0000000007a1', '5ec20000-0000-4000-8000-0000000007a1', '2031-02', 3) $$,
  'gestora: crea una meta');
select lives_ok(
  $$ update public.targets set target_value = 11 where id = '5ec30000-0000-4000-8000-0000000007a1' $$,
  'gestora: actualiza target_value');
select throws_ok(
  $$ update public.targets set target_value = -1 where id = '5ec30000-0000-4000-8000-0000000007a1' $$,
  '23514', null, 'gestora: meta negativa rechazada por la BD');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-0000000007a1', '5ec20000-0000-4000-8000-0000000007a1', '2031-13', 1) $$,
  '23514', null, 'gestora: mes inválido rechazado por la BD');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-0000000007a1', '5ec20000-0000-4000-8000-0000000007a1', '2031-01''; drop table public.targets; --', 1) $$,
  '23514', null, 'gestora: mes con payload SQL queda como texto y lo rechaza el CHECK');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-0000000007a1', '5ec20000-0000-4000-8000-0000000007a1', '2031-01', 5) $$,
  '23505', null, 'gestora: duplicado (unidad, indicador, mes) rechazado');

-- Auditoría (categoría 8): la escritura de la gestora queda registrada y no es editable.
reset role;
select ok(exists (select 1 from public.audit_log
                   where entity = 'targets' and action = 'update'
                     and entity_id = '5ec30000-0000-4000-8000-0000000007a1'),
  'auditoría: la actualización de la meta queda en audit_log');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.audit_log', 'DELETE'),
  'auditoría: authenticated no edita ni borra audit_log');

select * from finish();
rollback;
