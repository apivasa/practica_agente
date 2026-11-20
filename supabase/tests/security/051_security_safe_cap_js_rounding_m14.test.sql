-- Seguridad (M-14, H-ARQ-M13-01), categorías 1 y 3: verificación activa del borde nuevo de los
-- CHECK `_safe` (|v| < 2^53 - 0,5) por vías que no cubren las pruebas del desarrollador (114):
--  * Catálogo: cada uno de los 9 CHECK existe UNA sola vez (el reemplazo no dejó duplicados ni
--    huecos), validado (no NOT VALID), y ningún CHECK de public conserva el borde viejo 2^53.
--  * Con el rol que escribe cada columna bajo RLS (gestora, custodio): el borde 2^53 - 0,5 en
--    decimal y exponencial, UPDATE calculado que cruza el borde (2^53 - 1) + 0,5, jsonb_set y
--    `||` sobre los JSONB, INSERT nuevo; control positivo 2^53 - 0,6 (JS lo lee como 2^53 - 1).
--  * Líder y comité: no pueden escribir esas columnas ni con un valor válido (0 filas).
begin;
select plan(26);

-- Catálogo --------------------------------------------------------------------
select is(
  (select count(*)::int || '/' || count(distinct conname)::int || '/' || count(*) filter (where convalidated)::int
     from pg_constraint
    where contype = 'c' and connamespace = 'public'::regnamespace and conname in (
      'indicators_green_threshold_safe', 'indicators_yellow_threshold_safe',
      'indicators_thresholds_by_category_safe',
      'commitments_green_override_safe', 'commitments_yellow_override_safe',
      'commitments_package_total_safe', 'commitments_package_by_category_safe',
      'targets_target_value_safe', 'measurements_value_safe')),
  '9/9/9', 'los 9 CHECK _safe existen una sola vez cada uno y están validados');

select is_empty(
  $$ select conrelid::regclass || '.' || conname from pg_constraint
      where contype = 'c' and connamespace = 'public'::regnamespace
        and pg_get_constraintdef(oid) ~ '(<|>=)\s*9007199254740992\M' $$,
  'ningún CHECK de public conserva el borde viejo 2^53 (todos pasaron a 2^53 - 0,5)');

select is_empty(
  $$ select conname from pg_constraint
      where contype = 'c' and connamespace = 'public'::regnamespace
        and conname like '%\_safe'
        and pg_get_constraintdef(oid) !~ '9007199254740991\.5' $$,
  'todo CHECK _safe de public usa el borde 9007199254740991.5');

-- Fixtures --------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('5ec00000-0000-4000-8000-000000000d01', 'sec-m14-gestora@example.test',  'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000d02', 'sec-m14-custodio@example.test', 'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000d03', 'sec-m14-lider@example.test',    'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000d04', 'sec-m14-comite@example.test',   'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('5ec10000-0000-4000-8000-000000000d01', 'SEC M14 Unidad', '5ec00000-0000-4000-8000-000000000d03');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category) values
  ('5ec20000-0000-4000-8000-000000000d01', 'SEC_M14_AVG', 'SEC M14 promedio', 'window_average', 'higher_is_better', 95, 90, '{}'),
  ('5ec20000-0000-4000-8000-000000000d02', 'SEC_M14_CUM', 'SEC M14 acumulado', 'cumulative_target', 'higher_is_better', 100, 80,
   '{"P0P1": {"green": 100, "yellow": 80}}'),
  ('5ec20000-0000-4000-8000-000000000d03', 'SEC_M14_LOW', 'SEC M14 menos es mejor', 'window_average', 'lower_is_better', 90, 100, '{}');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec00000-0000-4000-8000-000000000d01', 'kpi_manager', null, null),
  ('5ec00000-0000-4000-8000-000000000d02', 'custodian',   null, '5ec20000-0000-4000-8000-000000000d01'),
  ('5ec00000-0000-4000-8000-000000000d02', 'custodian',   null, '5ec20000-0000-4000-8000-000000000d02'),
  ('5ec00000-0000-4000-8000-000000000d03', 'unit_leader', '5ec10000-0000-4000-8000-000000000d01', null),
  ('5ec00000-0000-4000-8000-000000000d04', 'committee',   null, null);
insert into public.targets (id, unit_id, indicator_id, month, target_value) values
  ('5ec30000-0000-4000-8000-000000000d01', '5ec10000-0000-4000-8000-000000000d01', '5ec20000-0000-4000-8000-000000000d02', '2031-01', 10);
insert into public.commitments (id, unit_id, indicator_id, period, package_total, package_by_category, created_by) values
  ('5ec50000-0000-4000-8000-000000000d01', '5ec10000-0000-4000-8000-000000000d01', '5ec20000-0000-4000-8000-000000000d02', '2031-Q1', 30,
   '{"P0P1": 20, "P2P3": 10}', '5ec00000-0000-4000-8000-000000000d02');
insert into public.commitments (id, unit_id, indicator_id, period, green_override, yellow_override, created_by) values
  ('5ec50000-0000-4000-8000-000000000d02', '5ec10000-0000-4000-8000-000000000d01', '5ec20000-0000-4000-8000-000000000d01', '2031-01', 97, 92,
   '5ec00000-0000-4000-8000-000000000d02');
insert into public.measurements (id, unit_id, indicator_id, measured_on, value, created_by) values
  ('5ec60000-0000-4000-8000-000000000d01', '5ec10000-0000-4000-8000-000000000d01', '5ec20000-0000-4000-8000-000000000d01',
   '2031-01-02', 9007199254740991, '5ec00000-0000-4000-8000-000000000d02');

set local role authenticated;

-- Gestora ----------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000d01","role":"authenticated"}';
select throws_ok(
  $$ update public.indicators set green_threshold = 9007199254740991.5 where id = '5ec20000-0000-4000-8000-000000000d01' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'gestora: green_threshold 2^53 - 0,5 (JS lo lee como 2^53) rechazado');
select throws_ok(
  $$ update public.indicators set green_threshold = '9.0071992547409915e15' where id = '5ec20000-0000-4000-8000-000000000d01' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'gestora: green_threshold 9.0071992547409915e15 (exponencial del borde) rechazado');
select throws_ok(
  $$ update public.indicators set yellow_threshold = 9007199254740991.75 where id = '5ec20000-0000-4000-8000-000000000d03' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_safe"',
  'gestora: yellow_threshold 2^53 - 0,25 (menos es mejor) rechazado');
select throws_ok(
  $$ update public.indicators set green_threshold = -9007199254740991.5 where id = '5ec20000-0000-4000-8000-000000000d03' $$,
  '23514', null,
  'gestora: green_threshold -(2^53 - 0,5) rechazado (simétrico)');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = jsonb_set(thresholds_by_category, '{P0P1,green}', '9007199254740991.5')
      where id = '5ec20000-0000-4000-8000-000000000d02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: jsonb_set de green a 2^53 - 0,5 rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = thresholds_by_category
       || '{"P2P3": {"green": 1, "yellow": -9.0071992547409915E+15}}'
      where id = '5ec20000-0000-4000-8000-000000000d02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: || con yellow -9.0071992547409915E+15 en una categoría nueva rechazado');
select throws_ok(
  $$ update public.targets set target_value = 9007199254740991.5 where id = '5ec30000-0000-4000-8000-000000000d01' $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'gestora: target_value 2^53 - 0,5 rechazado');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-000000000d01', '5ec20000-0000-4000-8000-000000000d02', '2031-02', '9007199254740991.50000000001') $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'gestora: INSERT de meta apenas por encima del borde rechazado');
select lives_ok(
  $$ update public.targets set target_value = 9007199254740991.4 where id = '5ec30000-0000-4000-8000-000000000d01' $$,
  'gestora: target_value 2^53 - 0,6 aceptado (control positivo: JS lo lee como 2^53 - 1)');
select is(
  (select target_value::text from public.targets where id = '5ec30000-0000-4000-8000-000000000d01'),
  '9007199254740991.4', 'la meta del control positivo se guardó exacta');
update public.targets set target_value = 10 where id = '5ec30000-0000-4000-8000-000000000d01';

-- Custodio ---------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000d02","role":"authenticated"}';
select throws_ok(
  $$ update public.commitments set package_total = 9007199254740991.5 where id = '5ec50000-0000-4000-8000-000000000d01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_total_safe"',
  'custodio: package_total 2^53 - 0,5 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = jsonb_set(package_by_category, '{P0P1}', '9007199254740991.5')
      where id = '5ec50000-0000-4000-8000-000000000d01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: jsonb_set de una clave del paquete a 2^53 - 0,5 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = package_by_category || '{"P2P3": 9.0071992547409915e15}'
      where id = '5ec50000-0000-4000-8000-000000000d01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: || con 9.0071992547409915e15 rechazado');
select throws_ok(
  $$ update public.commitments set green_override = 9007199254740991.5 where id = '5ec50000-0000-4000-8000-000000000d02' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_safe"',
  'custodio: green_override 2^53 - 0,5 rechazado');
select throws_ok(
  $$ update public.commitments set yellow_override = -9007199254740991.5 where id = '5ec50000-0000-4000-8000-000000000d02' $$,
  '23514', null,
  'custodio: yellow_override -(2^53 - 0,5) rechazado (simétrico)');
select throws_ok(
  $$ update public.measurements set value = value + 0.5 where id = '5ec60000-0000-4000-8000-000000000d01' $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: UPDATE calculado (2^53 - 1) + 0,5 rechazado');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('5ec10000-0000-4000-8000-000000000d01', '5ec20000-0000-4000-8000-000000000d01', '2031-01-03', ' 9.0071992547409915E15 ') $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: INSERT de medición " 9.0071992547409915E15 " rechazado');
select lives_ok(
  $$ update public.measurements set value = value + 0.4 where id = '5ec60000-0000-4000-8000-000000000d01' $$,
  'custodio: (2^53 - 1) + 0,4 aceptado (control positivo)');

-- Líder y comité: sin escritura (ni con valores válidos) ----------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000d03","role":"authenticated"}';
select lives_ok(
  $$ update public.targets set target_value = 9007199254740991.4 where id = '5ec30000-0000-4000-8000-000000000d01' $$,
  'líder: UPDATE de meta no falla pero RLS no le deja filas');
select lives_ok(
  $$ update public.commitments set package_total = 9007199254740991.4 where id = '5ec50000-0000-4000-8000-000000000d01' $$,
  'líder: UPDATE de paquete no falla pero RLS no le deja filas');
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000d04","role":"authenticated"}';
select lives_ok(
  $$ update public.indicators set green_threshold = 9007199254740991.4 where id = '5ec20000-0000-4000-8000-000000000d01' $$,
  'comité: UPDATE de umbral no falla pero RLS no le deja filas');

reset role;
select is(
  (select green_threshold::text || '|' || yellow_threshold::text from public.indicators where id = '5ec20000-0000-4000-8000-000000000d01')
  || '#' || (select green_threshold::text || '|' || yellow_threshold::text from public.indicators where id = '5ec20000-0000-4000-8000-000000000d03')
  || '#' || (select thresholds_by_category::text from public.indicators where id = '5ec20000-0000-4000-8000-000000000d02')
  || '#' || (select target_value::text from public.targets where id = '5ec30000-0000-4000-8000-000000000d01')
  || '#' || (select package_total::text || '|' || package_by_category::text from public.commitments where id = '5ec50000-0000-4000-8000-000000000d01')
  || '#' || (select green_override::text || '|' || yellow_override::text from public.commitments where id = '5ec50000-0000-4000-8000-000000000d02'),
  '95|90#90|100#{"P0P1": {"green": 100, "yellow": 80}}#10#30|{"P0P1": 20, "P2P3": 10}#97|92',
  'umbrales, meta, paquete y overrides intactos tras los intentos rechazados y los del líder y el comité');
select is(
  (select value::text from public.measurements where id = '5ec60000-0000-4000-8000-000000000d01')
  || '#' || (select count(*)::int from public.measurements
              where indicator_id = '5ec20000-0000-4000-8000-000000000d01' and measured_on = '2031-01-03')::text
  || '#' || (select count(*)::int from public.targets where month = '2031-02'
              and indicator_id = '5ec20000-0000-4000-8000-000000000d02')::text,
  '9007199254740991.4#0#0', 'solo prosperó el control positivo; ninguna fila creada por los intentos rechazados');

select * from finish();
rollback;
