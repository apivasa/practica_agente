-- Seguridad (M-12), categorías 1 y 3: verificación activa del cierre de H-M11-01..03 por vías
-- que no cubren las pruebas del desarrollador (112):
--  * Catálogo: los 3 CHECK de M-12 están validados y no dependen de funciones propias (sin
--    superficie RPC nueva); measurements.value tiene CHECK con tope 2^53 (ya sin excepción en 049).
--  * Gestora bajo RLS: UPDATE parcial del JSONB de umbrales con jsonb_set, jsonb_insert, `||` y
--    `#-` (cambiar un valor, añadir clave, quitar clave, convertir en arreglo o cadena), upsert
--    por `code`, notación exponencial, claves con mayúsculas o espacios, claves duplicadas.
--  * Custodio bajo RLS: measurements.value con exponencial, cadena con espacios y UPDATE calculado
--    en un indicador sin categorías; package_by_category con jsonb_set/|| a fracción o negativo,
--    1e-16000, 9007199254740991.9999, upsert por (unidad, indicador, periodo); claves libres y -0.
--  * Líder de unidad: no puede escribir umbrales ni paquetes (0 filas, valores intactos).
begin;
select plan(34);

-- Catálogo --------------------------------------------------------------------
select is(
  (select count(*)::int from pg_constraint
    where contype = 'c' and convalidated and conname in (
      'indicators_thresholds_by_category_safe', 'measurements_value_safe',
      'commitments_package_by_category_whole')),
  3, 'los 3 CHECK de M-12 existen y están validados (no NOT VALID)');

select is_empty(
  $$ select k.conname from pg_constraint k
       join pg_depend d on d.classid = 'pg_constraint'::regclass and d.objid = k.oid
                       and d.refclassid = 'pg_proc'::regclass
       join pg_proc p on p.oid = d.refobjid
       join pg_namespace n on n.oid = p.pronamespace
      where k.conname in ('indicators_thresholds_by_category_safe', 'measurements_value_safe',
                          'commitments_package_by_category_whole')
        and n.nspname not in ('pg_catalog', 'information_schema') $$,
  'los CHECK de M-12 no dependen de funciones propias (sin superficie RPC nueva)');

select ok(
  exists (select 1 from pg_constraint
           where conrelid = 'public.measurements'::regclass and contype = 'c' and convalidated
             and pg_get_constraintdef(oid) like '%abs(value)%9007199254740992%'),
  'measurements.value tiene CHECK validado |v| < 2^53 (cierre de H-M11-02)');

-- Fixtures --------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('5ec00000-0000-4000-8000-000000000c01', 'sec-m12-gestora@example.test',  'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000c02', 'sec-m12-custodio@example.test', 'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000c03', 'sec-m12-lider@example.test',    'authenticated', 'authenticated');
insert into public.units (id, name, leader_user_id) values
  ('5ec10000-0000-4000-8000-000000000c01', 'SEC M12 Unidad', '5ec00000-0000-4000-8000-000000000c03');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category) values
  ('5ec20000-0000-4000-8000-000000000c01', 'SEC_M12_AVG', 'SEC M12 promedio', 'window_average', 'higher_is_better', 95, 90, '{}'),
  ('5ec20000-0000-4000-8000-000000000c02', 'SEC_M12_CUM', 'SEC M12 acumulado', 'cumulative_target', 'higher_is_better', 100, 80,
   '{"P0P1": {"green": 100, "yellow": 80}}');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec00000-0000-4000-8000-000000000c01', 'kpi_manager', null, null),
  ('5ec00000-0000-4000-8000-000000000c02', 'custodian',   null, '5ec20000-0000-4000-8000-000000000c01'),
  ('5ec00000-0000-4000-8000-000000000c02', 'custodian',   null, '5ec20000-0000-4000-8000-000000000c02'),
  ('5ec00000-0000-4000-8000-000000000c03', 'unit_leader', '5ec10000-0000-4000-8000-000000000c01', null);
insert into public.commitments (id, unit_id, indicator_id, period, package_total, package_by_category, created_by) values
  ('5ec50000-0000-4000-8000-000000000c01', '5ec10000-0000-4000-8000-000000000c01', '5ec20000-0000-4000-8000-000000000c02', '2031-Q1', 30,
   '{"P0P1": 20, "P2P3": 10}', '5ec00000-0000-4000-8000-000000000c02');
insert into public.measurements (id, unit_id, indicator_id, measured_on, value, created_by) values
  ('5ec60000-0000-4000-8000-000000000c01', '5ec10000-0000-4000-8000-000000000c01', '5ec20000-0000-4000-8000-000000000c01',
   '2031-01-02', 9007199254740991, '5ec00000-0000-4000-8000-000000000c02');

set local role authenticated;

-- Gestora: thresholds_by_category (H-M11-01) ----------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000c01","role":"authenticated"}';
select throws_ok(
  $$ update public.indicators set thresholds_by_category = jsonb_set(thresholds_by_category, '{P0P1,green}', '1e400')
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: jsonb_set de green a 1e400 rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = jsonb_set(thresholds_by_category, '{P0P1,extra}', '1')
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: jsonb_set que añade una clave extra rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = jsonb_insert(thresholds_by_category, '{P0P1,zz}', '1')
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: jsonb_insert de una clave extra rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = thresholds_by_category #- '{P0P1,yellow}'
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: #- que quita yellow rechazado (falta una clave obligatoria)');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = thresholds_by_category || '{"P0P1": {"green": 1}}'
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: || que reemplaza la categoría por un objeto incompleto rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = jsonb_set(thresholds_by_category, '{P0P1,green}', '"100"')
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: jsonb_set de green a cadena numérica rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = jsonb_set(thresholds_by_category, '{P0P1}', '[100, 80]')
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: jsonb_set de la categoría a arreglo rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category)
     values ('SEC_M12_CUM', 'x', 'cumulative_target', 'higher_is_better', 1, 0, '{"P0P1": {"green": 1e400, "yellow": 1}}')
     on conflict (code) do update set thresholds_by_category = excluded.thresholds_by_category $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: upsert por code con green 1e400 rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category)
     values ('SEC_M12_NEW', 'x', 'cumulative_target', 'higher_is_better', 1, 0, '{"P0P1": {"green": 1, "yellow": 0.9007199254740992E+16}}') $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: INSERT con yellow 0.9007199254740992E+16 (= 2^53) rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"Green": 100, "yellow": 80}}'
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: clave "Green" (mayúscula) rechazada');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green ": 100, "yellow": 80}}'
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: clave "green " (con espacio) rechazada');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": null, "yellow": 80}}'
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: green null rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 1, "yellow": 2, "green": 1e400}}'
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: clave duplicada cuyo último valor es 1e400 rechazada');
select lives_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 1e400, "yellow": -9007199254740991, "green": 9007199254740991}}'
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  'gestora: clave duplicada (JSONB conserva la última, segura) y ±(2^53 - 1) aceptados');
select is(
  (select thresholds_by_category::text from public.indicators where id = '5ec20000-0000-4000-8000-000000000c02'),
  '{"P0P1": {"green": 9007199254740991, "yellow": -9007199254740991}}',
  'clave duplicada: lo guardado es el último valor, no 1e400');
update public.indicators set thresholds_by_category = '{"P0P1": {"green": 100, "yellow": 80}}'
 where id = '5ec20000-0000-4000-8000-000000000c02';

-- Custodio: measurements.value sin categorías (H-M11-02) -------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000c02","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('5ec10000-0000-4000-8000-000000000c01', '5ec20000-0000-4000-8000-000000000c01', '2031-01-03', '9.007199254740992e15') $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: value 9.007199254740992e15 (= 2^53) en indicador sin categorías rechazado');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('5ec10000-0000-4000-8000-000000000c01', '5ec20000-0000-4000-8000-000000000c01', '2031-01-03', '  1E400  ') $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: value "  1E400  " (mayúsculas y espacios) rechazado');
select throws_ok(
  $$ update public.measurements set value = value + 1 where id = '5ec60000-0000-4000-8000-000000000c01' $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: UPDATE calculado (2^53 - 1) + 1 rechazado');
select throws_ok(
  $$ update public.measurements set value = value * 1e300 where id = '5ec60000-0000-4000-8000-000000000c01' $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: UPDATE calculado x * 1e300 rechazado');
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('5ec10000-0000-4000-8000-000000000c01', '5ec20000-0000-4000-8000-000000000c01', '2031-01-04', '-0') $$,
  'custodio: value -0 aceptado (control positivo)');

-- Custodio: package_by_category entero >= 0 (H-M11-03) -------------------------------
select throws_ok(
  $$ update public.commitments set package_by_category = jsonb_set(package_by_category, '{P0P1}', '0.5')
      where id = '5ec50000-0000-4000-8000-000000000c01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'custodio: jsonb_set a fracción 0.5 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = package_by_category || '{"P2P3": -1}'
      where id = '5ec50000-0000-4000-8000-000000000c01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'custodio: || con negativo -1 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1e-16000}'
      where id = '5ec50000-0000-4000-8000-000000000c01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'custodio: 1e-16000 (~16 KB que JSON.parse vuelve 0) rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9007199254740991.9999}'
      where id = '5ec50000-0000-4000-8000-000000000c01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'custodio: 9007199254740991.9999 (JSON.parse lo lee como 2^53) rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_total, package_by_category)
     values ('5ec10000-0000-4000-8000-000000000c01', '5ec20000-0000-4000-8000-000000000c02', '2031-Q1', 30, '{"P0P1": 2.5}')
     on conflict (unit_id, indicator_id, period) do update set package_by_category = excluded.package_by_category $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'custodio: upsert por (unidad, indicador, periodo) con fracción rechazado');
select lives_ok(
  $$ update public.commitments set package_by_category = '{"Crítica": 1.0, "total": 1e2, "P2P3": -0}'
      where id = '5ec50000-0000-4000-8000-000000000c01' $$,
  'custodio: claves libres (categoría propia, total), 1.0, 1e2 y -0 aceptados (el front usa claves libres)');
update public.commitments set package_by_category = '{"P0P1": 20, "P2P3": 10}'
 where id = '5ec50000-0000-4000-8000-000000000c01';

-- Líder de unidad: sin escritura ---------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000c03","role":"authenticated"}';
select lives_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 1, "yellow": 0}}'
      where id = '5ec20000-0000-4000-8000-000000000c02' $$,
  'líder: UPDATE de umbrales no falla pero RLS no le deja filas');
select lives_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1}'
      where id = '5ec50000-0000-4000-8000-000000000c01' $$,
  'líder: UPDATE de paquete no falla pero RLS no le deja filas');

reset role;
select is(
  (select thresholds_by_category::text from public.indicators where id = '5ec20000-0000-4000-8000-000000000c02')
  || '#' || (select package_by_category::text from public.commitments where id = '5ec50000-0000-4000-8000-000000000c01')
  || '#' || (select value::text from public.measurements where id = '5ec60000-0000-4000-8000-000000000c01'),
  '{"P0P1": {"green": 100, "yellow": 80}}#{"P0P1": 20, "P2P3": 10}#9007199254740991',
  'umbrales, paquete y medición conservan su valor tras los intentos rechazados y los del líder');
select is(
  (select count(*)::int from public.indicators where code = 'SEC_M12_NEW')
  + (select count(*)::int from public.measurements
      where indicator_id = '5ec20000-0000-4000-8000-000000000c01' and measured_on = '2031-01-03'),
  0, 'no quedó ningún indicador ni medición creados por los intentos rechazados');
select ok(
  not exists (select 1 from public.measurements where not (abs(value) < 9007199254740992))
  and not exists (select 1 from public.commitments where package_by_category is not null
                    and jsonb_path_exists(package_by_category, 'strict $.* ? (@.type() != "number" || @ < 0 || @ != @.floor())')),
  'ninguna medición ni paquete guardados (incluida la semilla) incumple M-12');

select * from finish();
rollback;
