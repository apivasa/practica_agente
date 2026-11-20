-- Seguridad (M-09), categorías 1, 3 y 8: verificación activa del cierre de H-M07-01 y
-- H-M08-01 por vías que no cubren las pruebas del desarrollador (090):
--  * targets: evasión del privilegio de columna por upsert (on conflict do update) y por
--    UPDATE que mezcla target_value con columnas no concedidas; RLS sigue limitando
--    target_value a la gestora; la auditoría registra el cambio permitido.
--  * measurements: el custodio no convierte una fila válida en NaN/Infinity/2^53 por
--    UPDATE (la API le concede UPDATE de value); variantes de escritura de 'nan'.
--  * La función del trigger reemplazada conserva search_path vacío, security definer sin
--    EXECUTE para la API, el trigger sigue enganchado y el CHECK nuevo está validado.
begin;
select plan(22);

insert into auth.users (id, email, aud, role) values
  ('5ec00000-0000-4000-8000-0000000009c1', 'sec-m09-gestora@example.test',  'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000009c2', 'sec-m09-custodio@example.test', 'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-0000000009c3', 'sec-m09-lider@example.test',    'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('5ec10000-0000-4000-8000-0000000009c1', 'SEC M09 Unidad A', '5ec00000-0000-4000-8000-0000000009c3'),
  ('5ec10000-0000-4000-8000-0000000009c2', 'SEC M09 Unidad B', null);
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category) values
  ('5ec20000-0000-4000-8000-0000000009c1', 'SEC_M09_VULN', 'SEC M09 VULN', 'cumulative_target', 'higher_is_better', 96, 90,
   '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 75}}'),
  ('5ec20000-0000-4000-8000-0000000009c2', 'SEC_M09_AVG', 'SEC M09 promedio', 'window_average', 'higher_is_better', 2, 1, '{}');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec00000-0000-4000-8000-0000000009c1', 'kpi_manager', null, null),
  ('5ec00000-0000-4000-8000-0000000009c2', 'custodian',   null, '5ec20000-0000-4000-8000-0000000009c1'),
  ('5ec00000-0000-4000-8000-0000000009c2', 'custodian',   null, '5ec20000-0000-4000-8000-0000000009c2'),
  ('5ec00000-0000-4000-8000-0000000009c3', 'unit_leader', '5ec10000-0000-4000-8000-0000000009c1', null);
insert into public.targets (id, unit_id, indicator_id, month, target_value) values
  ('5ec30000-0000-4000-8000-0000000009c1', '5ec10000-0000-4000-8000-0000000009c1', '5ec20000-0000-4000-8000-0000000009c1', '2031-01', 10);
insert into public.measurements (id, unit_id, indicator_id, measured_on, value, category, kind) values
  ('5ec40000-0000-4000-8000-0000000009c1', '5ec10000-0000-4000-8000-0000000009c1', '5ec20000-0000-4000-8000-0000000009c1', '2031-01-10', 5, 'P0P1', 'resolved');
insert into public.measurements (id, unit_id, indicator_id, measured_on, value) values
  ('5ec40000-0000-4000-8000-0000000009c2', '5ec10000-0000-4000-8000-0000000009c1', '5ec20000-0000-4000-8000-0000000009c2', '2031-01-10', 1.5);

-- Catálogo: la función reemplazada sigue endurecida y el trigger enganchado.
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname = 'check_measurement_category'),
  'check_measurement_category: security definer con search_path vacío tras el replace');
select ok(not has_function_privilege('authenticated', 'private.check_measurement_category()', 'EXECUTE')
          and not has_function_privilege('anon', 'private.check_measurement_category()', 'EXECUTE'),
  'check_measurement_category: sin EXECUTE para anon ni authenticated');
select ok(exists (select 1 from pg_trigger
                   where tgname = 'measurements_category_guard'
                     and tgrelid = 'public.measurements'::regclass and tgenabled <> 'D'),
  'measurements_category_guard sigue enganchado y activo');
select ok((select convalidated from pg_constraint
            where conname = 'measurements_value_finite' and conrelid = 'public.measurements'::regclass),
  'measurements_value_finite está validado (no NOT VALID)');

set local role authenticated;

-- H-M07-01: gestora, evasión del privilegio de columna.
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000009c1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-0000000009c1', '5ec20000-0000-4000-8000-0000000009c1', '2031-01', 7)
     on conflict (unit_id, indicator_id, month) do update set unit_id = '5ec10000-0000-4000-8000-0000000009c2' $$,
  '42501', null, 'gestora: upsert con do update set unit_id no mueve la meta');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-0000000009c1', '5ec20000-0000-4000-8000-0000000009c1', '2031-01', 7)
     on conflict (unit_id, indicator_id, month) do update set month = '2031-02', target_value = excluded.target_value $$,
  '42501', null, 'gestora: upsert con do update set month no mueve la meta');
select throws_ok(
  $$ update public.targets set target_value = 8, indicator_id = '5ec20000-0000-4000-8000-0000000009c2'
      where id = '5ec30000-0000-4000-8000-0000000009c1' $$,
  '42501', null, 'gestora: UPDATE que mezcla target_value con indicator_id se rechaza entero');
select throws_ok(
  $$ update public.targets set id = gen_random_uuid() where id = '5ec30000-0000-4000-8000-0000000009c1' $$,
  '42501', null, 'gestora: no reasigna el id de una meta');
select lives_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-0000000009c1', '5ec20000-0000-4000-8000-0000000009c1', '2031-01', 7)
     on conflict (unit_id, indicator_id, month) do update set target_value = excluded.target_value $$,
  'gestora: upsert que solo toca target_value pasa');

-- Líder: tiene el privilegio de columna, pero RLS sigue sin dejarle escribir.
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000009c3","role":"authenticated"}';
select is_empty(
  $$ update public.targets set target_value = 0 where id = '5ec30000-0000-4000-8000-0000000009c1' returning id $$,
  'líder: UPDATE de target_value de su propia unidad no afecta filas (RLS)');

-- H-M08-01: custodio, evasión por UPDATE de una fila válida.
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-0000000009c2","role":"authenticated"}';
select throws_ok(
  $$ update public.measurements set value = 'NaN' where id = '5ec40000-0000-4000-8000-0000000009c1' $$,
  '23514', null, 'custodio: UPDATE a NaN en VULN se rechaza');
select throws_ok(
  $$ update public.measurements set value = 'Infinity' where id = '5ec40000-0000-4000-8000-0000000009c1' $$,
  '23514', null, 'custodio: UPDATE a Infinity en VULN se rechaza');
select throws_ok(
  $$ update public.measurements set value = 9007199254740992 where id = '5ec40000-0000-4000-8000-0000000009c1' $$,
  '23514', null, 'custodio: UPDATE a 2^53 en VULN se rechaza');
select throws_ok(
  $$ update public.measurements set value = '  nan ' where id = '5ec40000-0000-4000-8000-0000000009c2' $$,
  '23514', null, 'custodio: UPDATE a "  nan " (minúsculas y espacios) en un promedio se rechaza');
select throws_ok(
  $$ update public.measurements set value = 'inf' where id = '5ec40000-0000-4000-8000-0000000009c2' $$,
  '23514', null, 'custodio: UPDATE a "inf" en un promedio se rechaza');
select throws_ok(
  $$ update public.measurements set value = '-Infinity' where id = '5ec40000-0000-4000-8000-0000000009c2' $$,
  '23514', null, 'custodio: UPDATE a -Infinity en un promedio se rechaza');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('5ec10000-0000-4000-8000-0000000009c1', '5ec20000-0000-4000-8000-0000000009c1', '2031-01-11', 'NaN', 'p0p1', 'resolved') $$,
  '23514', null, 'custodio: NaN con categoría en minúsculas en VULN se rechaza');
select lives_ok(
  $$ update public.measurements set value = 9007199254740991 where id = '5ec40000-0000-4000-8000-0000000009c1' $$,
  'custodio: UPDATE a 2^53 - 1 en VULN pasa');

reset role;
select is((select value from public.measurements where id = '5ec40000-0000-4000-8000-0000000009c2'),
  1.5::numeric, 'la medición del promedio conserva su valor tras los intentos rechazados');
select is((select unit_id::text || '|' || indicator_id::text || '|' || month || '|' || target_value::text
             from public.targets where id = '5ec30000-0000-4000-8000-0000000009c1'),
  '5ec10000-0000-4000-8000-0000000009c1|5ec20000-0000-4000-8000-0000000009c1|2031-01|7',
  'la meta conserva unidad, indicador y mes; solo cambió target_value');
select ok(exists (select 1 from public.audit_log
                   where entity = 'targets' and action = 'update'
                     and entity_id = '5ec30000-0000-4000-8000-0000000009c1'),
  'auditoría: el upsert permitido de la gestora queda en audit_log');
select ok(not exists (select 1 from public.measurements
                       where value = 'NaN'::numeric or value = 'Infinity'::numeric or value = '-Infinity'::numeric),
  'ninguna medición no finita en la tabla');

select * from finish();
rollback;
