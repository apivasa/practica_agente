-- Seguridad (M-08), categorías 1 y 3: trigger AFTER measurements_category_guard
-- (security definer, search_path vacío) y CHECK indicators_cumulative_direction.
--  * Endurecimiento de la función: sin EXECUTE para los roles de la API, search_path
--    fijo, dueño que no es un rol de la API; nadie desactiva el trigger ni reemplaza
--    la función desde la API.
--  * Orden respecto a RLS: un rol sin permiso recibe 42501 aunque la fila sea inválida
--    (el trigger no sirve de oráculo de la configuración del indicador).
--  * Evasión: UPDATE de una fila válida a inválida, variantes de mayúsculas/espacios,
--    y quitar las categorías del indicador para saltarse la regla.
begin;
select plan(19);

insert into auth.users (id, email, aud, role) values
  ('5ec00000-0000-4000-8000-0000000008b1', 'sec-m08-custodio-vuln@example.test', 'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000008b2', 'sec-m08-custodio-otro@example.test', 'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000008b3', 'sec-m08-comite@example.test',        'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000008b4', 'sec-m08-lider@example.test',         'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000008b5', 'sec-m08-gestora@example.test',       'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('5ec10000-0000-4000-8000-0000000008b1', 'SEC M08 Unidad', '5ec00000-0000-4000-8000-0000000008b4');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category) values
  ('5ec20000-0000-4000-8000-0000000008b1', 'SEC_M08_VULN', 'SEC M08 VULN', 'cumulative_target', 'higher_is_better', 96, 90,
   '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 75}}'),
  ('5ec20000-0000-4000-8000-0000000008b2', 'SEC_M08_AVG', 'SEC M08 promedio', 'window_average', 'higher_is_better', 2, 1, '{}');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec00000-0000-4000-8000-0000000008b1', 'custodian',   null, '5ec20000-0000-4000-8000-0000000008b1'),
  ('5ec00000-0000-4000-8000-0000000008b2', 'custodian',   null, '5ec20000-0000-4000-8000-0000000008b2'),
  ('5ec00000-0000-4000-8000-0000000008b3', 'committee',   null, null),
  ('5ec00000-0000-4000-8000-0000000008b4', 'unit_leader', '5ec10000-0000-4000-8000-0000000008b1', null),
  ('5ec00000-0000-4000-8000-0000000008b5', 'kpi_manager', null, null);
insert into public.measurements (id, unit_id, indicator_id, measured_on, value, category, kind, created_by) values
  ('5ec40000-0000-4000-8000-0000000008b1', '5ec10000-0000-4000-8000-0000000008b1', '5ec20000-0000-4000-8000-0000000008b1',
   '2031-01-15', 4, 'P0P1', 'resolved', '5ec00000-0000-4000-8000-0000000008b1');

-- Endurecimiento de la función y del trigger
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'private.check_measurement_category'::regproc),
  'check_measurement_category fija search_path vacío');
select ok(not has_function_privilege('authenticated', 'private.check_measurement_category()', 'EXECUTE')
          and not has_function_privilege('anon', 'private.check_measurement_category()', 'EXECUTE'),
  'anon/authenticated: no ejecutan la función del trigger');
select ok((select r.rolname not in ('anon', 'authenticated', 'authenticator')
             from pg_proc p join pg_roles r on r.oid = p.proowner
            where p.oid = 'private.check_measurement_category'::regproc),
  'la función security definer no pertenece a un rol de la API');
select ok(not has_schema_privilege('authenticated', 'private', 'CREATE')
          and not has_schema_privilege('anon', 'private', 'CREATE'),
  'anon/authenticated: no crean ni reemplazan funciones en private');
select is((select array_agg(event_manipulation::text order by event_manipulation::text)
             from information_schema.triggers
            where event_object_schema = 'public' and event_object_table = 'measurements'
              and trigger_name = 'measurements_category_guard' and action_timing = 'AFTER'
              and action_orientation = 'ROW'),
  array['INSERT', 'UPDATE'], 'measurements_category_guard es AFTER ROW en INSERT y UPDATE');

set local role authenticated;

-- Orden respecto a RLS: sin permiso, 42501 aunque la fila sea inválida (sin oráculo).
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000008b2","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind, created_by)
     values ('5ec10000-0000-4000-8000-0000000008b1', '5ec20000-0000-4000-8000-0000000008b1', '2031-01-16', 0.5, null, 'resolved',
             '5ec00000-0000-4000-8000-0000000008b2') $$,
  '42501', null, 'custodio de otro KPI: fila inválida en VULN da 42501 (RLS antes que el trigger)');
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000008b4","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind, created_by)
     values ('5ec10000-0000-4000-8000-0000000008b1', '5ec20000-0000-4000-8000-0000000008b1', '2031-01-16', 0.5, null, 'resolved',
             '5ec00000-0000-4000-8000-0000000008b4') $$,
  '42501', null, 'líder: fila inválida en VULN da 42501');
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000008b3","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind, created_by)
     values ('5ec10000-0000-4000-8000-0000000008b1', '5ec20000-0000-4000-8000-0000000008b1', '2031-01-16', 0.5, null, 'resolved',
             '5ec00000-0000-4000-8000-0000000008b3') $$,
  '42501', null, 'comité: fila inválida en VULN da 42501');

-- Custodio de VULN: variantes que evaden un filtro ingenuo.
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000008b1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind, created_by)
     values ('5ec10000-0000-4000-8000-0000000008b1', '5ec20000-0000-4000-8000-0000000008b1', '2031-01-16', 1, 'p0p1', 'resolved',
             '5ec00000-0000-4000-8000-0000000008b1') $$,
  '23514', null, 'custodio VULN: categoría en minúsculas rechazada');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind, created_by)
     values ('5ec10000-0000-4000-8000-0000000008b1', '5ec20000-0000-4000-8000-0000000008b1', '2031-01-16', 1, ' P0P1', 'resolved',
             '5ec00000-0000-4000-8000-0000000008b1') $$,
  '23514', null, 'custodio VULN: categoría con espacio rechazada');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind, created_by)
     values ('5ec10000-0000-4000-8000-0000000008b1', '5ec20000-0000-4000-8000-0000000008b1', '2031-01-16', 1, 'P0P1''); --', 'resolved',
             '5ec00000-0000-4000-8000-0000000008b1') $$,
  '23514', null, 'custodio VULN: categoría con payload SQL queda como texto y se rechaza');
select throws_ok(
  $$ update public.measurements set category = null where id = '5ec40000-0000-4000-8000-0000000008b1' $$,
  '23514', null, 'custodio VULN: UPDATE que deja la categoría nula se rechaza');
select throws_ok(
  $$ update public.measurements set value = 4.5 where id = '5ec40000-0000-4000-8000-0000000008b1' $$,
  '23514', null, 'custodio VULN: UPDATE a valor decimal se rechaza');
select throws_ok(
  $$ update public.measurements set category = 'P9' where id = '5ec40000-0000-4000-8000-0000000008b1' $$,
  '23514', null, 'custodio VULN: UPDATE a categoría desconocida se rechaza');

-- Evasión por configuración: el custodio no puede quitar las categorías ni cambiar el tipo.
update public.indicators set thresholds_by_category = '{}'::jsonb, measurement_type = 'window_average'
 where id = '5ec20000-0000-4000-8000-0000000008b1';
select throws_ok(
  $$ alter table public.measurements disable trigger measurements_category_guard $$,
  '42501', null, 'custodio: no desactiva el trigger');

-- La gestora tampoco desactiva el trigger (no es dueña de la tabla).
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000008b5","role":"authenticated"}';
select throws_ok(
  $$ alter table public.measurements disable trigger measurements_category_guard $$,
  '42501', null, 'gestora: no desactiva el trigger');
select throws_ok(
  $$ update public.indicators set direction = 'lower_is_better', green_threshold = 4, yellow_threshold = 8
      where id = '5ec20000-0000-4000-8000-0000000008b1' $$,
  '23514', null, 'gestora: no pasa VULN a "menos es mejor" por la API');

reset role;
select is((select measurement_type::text || '|' || (thresholds_by_category = '{}'::jsonb)::text
             from public.indicators where id = '5ec20000-0000-4000-8000-0000000008b1'),
  'cumulative_target|false', 'custodio: no cambia el tipo ni quita las categorías del indicador');
select is((select category || '|' || value::text from public.measurements where id = '5ec40000-0000-4000-8000-0000000008b1'),
  'P0P1|4', 'la medición original queda intacta tras los intentos');

select * from finish();
rollback;
