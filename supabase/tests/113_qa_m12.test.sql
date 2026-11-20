-- QA M-12 (H-M11-01..03): casos que no cubren las pruebas del desarrollador (112).
-- Trazas:
--  - plan-maestro M-12: "pgTAP por clave y por columna" -> el valor malo en una categoría que no
--    es la primera, en `yellow` y no solo en `green`; por INSERT además de UPDATE; booleano,
--    objeto anidado, clave con otra capitalización, raíz escalar; 2^53 en notación exponencial.
--  - plan-maestro M-12: "tope en measurements.value" -> también por UPDATE del custodio y en
--    notación exponencial; ±(2^53 - 0,6) en un promedio sigue entrando y 2^53 - 0,5 ya no (M-14,
--    H-ARQ-M13-01: el tope es |v| < 2^53 - 0,5, el borde de redondeo de JSON.parse).
--  - plan-maestro M-12: "enteros >= 0 en package_by_category" -> por INSERT, en la segunda clave,
--    -0,5, 2^53 - 1,5; un entero escrito como 1.0 o 1e2 es entero (lo que lee JSON.parse).
--  - plan-maestro M-12: "verificación previa a producción" -> las tres consultas comentadas de
--    la migración devuelven 0 filas sobre la semilla Y detectan filas malas (si no, la
--    verificación daría 0 filas siempre y no protegería la compuerta).
--  - diseño 4 ("Umbrales ... opcionalmente por categoría") + src/lib/indicator-form.js: la forma
--    que arma el formulario (nombres libres, decimales) sigue entrando.
--  - CLAUDE.md 4: prueba por rol -> los roles que no escriben la tabla siguen sin escribirla con un
--    valor válido (el CHECK no reemplaza ni rompe RLS).
begin;
select plan(54);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000001211', 'fx-qa-m12-gestora@example.test',   'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001212', 'fx-qa-m12-custodio@example.test',  'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001213', 'fx-qa-m12-custodio2@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001214', 'fx-qa-m12-lider@example.test',     'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001215', 'fx-qa-m12-comite@example.test',    'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000001211', 'FX QA M12 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category) values
  ('cccccccc-0000-4000-8000-000000001211', 'FX_QA_M12_CUM', 'FX QA M12 acumulado', 'cumulative_target', 'higher_is_better', 96, 90,
   '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 75}}'),
  ('cccccccc-0000-4000-8000-000000001212', 'FX_QA_M12_AVG', 'FX QA M12 promedio', 'window_average', 'higher_is_better', 99.9, 99.5, '{}'),
  ('cccccccc-0000-4000-8000-000000001213', 'FX_QA_M12_OTR', 'FX QA M12 ajeno', 'window_average', 'lower_is_better', 4, 8, '{}');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('aaaaaaaa-0000-4000-8000-000000001211', 'kpi_manager', null, null),
  ('aaaaaaaa-0000-4000-8000-000000001212', 'custodian',   null, 'cccccccc-0000-4000-8000-000000001211'),
  ('aaaaaaaa-0000-4000-8000-000000001212', 'custodian',   null, 'cccccccc-0000-4000-8000-000000001212'),
  ('aaaaaaaa-0000-4000-8000-000000001213', 'custodian',   null, 'cccccccc-0000-4000-8000-000000001213'),
  ('aaaaaaaa-0000-4000-8000-000000001214', 'unit_leader', 'bbbbbbbb-0000-4000-8000-000000001211', null),
  ('aaaaaaaa-0000-4000-8000-000000001215', 'committee',   null, null);
insert into public.commitments (id, unit_id, indicator_id, period, package_total, package_by_category, created_by) values
  ('dddddddd-0000-4000-8000-000000001211', 'bbbbbbbb-0000-4000-8000-000000001211', 'cccccccc-0000-4000-8000-000000001211',
   '2034-Q1', 300, '{"P0P1": 200, "P2P3": 100}', 'aaaaaaaa-0000-4000-8000-000000001212');
insert into public.measurements (id, unit_id, indicator_id, measured_on, value, created_by) values
  ('eeeeeeee-0000-4000-8000-000000001211', 'bbbbbbbb-0000-4000-8000-000000001211', 'cccccccc-0000-4000-8000-000000001212',
   '2034-01-05', 99.9, 'aaaaaaaa-0000-4000-8000-000000001212');

-- ---------------------------------------------------------------------------
-- Catálogo: cada CHECK está en su tabla (no en otra) y validado.
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(conrelid::regclass::text || '.' || conname, ',' order by conname) from pg_constraint
    where contype = 'c' and convalidated
      and conname in ('indicators_thresholds_by_category_safe', 'measurements_value_safe',
                      'commitments_package_by_category_whole')),
  'commitments.commitments_package_by_category_whole,indicators.indicators_thresholds_by_category_safe,measurements.measurements_value_safe',
  'los 3 CHECK de M-12 están en su tabla y validados');

-- ---------------------------------------------------------------------------
-- indicators.thresholds_by_category: escribe la gestora (RLS)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001211","role":"authenticated"}';
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category)
     values ('FX_QA_M12_N1', 'x', 'cumulative_target', 'higher_is_better', 96, 90, '{"P0P1": {"green": 1e400, "yellow": 90}}') $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: INSERT con umbral por categoría 1e400 rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 1e300}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: yellow 1e300 en la segunda categoría rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 9.007199254740992e15, "yellow": 90}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: green 2^53 en notación exponencial rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": true, "yellow": 90}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: booleano como umbral rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": {"v": 96}, "yellow": 90}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: objeto anidado como umbral rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"Green": 96, "yellow": 90}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: clave "Green" (otra capitalización) rechazada');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": null}'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: categoría con valor null rechazada');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"yellow": 75}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: falta green en la segunda categoría rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '96'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  '23514', null, 'gestora: raíz escalar rechazada con 23514 (no error de jsonpath)');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '"P0P1"'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  '23514', null, 'gestora: raíz cadena rechazada con 23514');
-- Forma del formulario (src/lib/indicator-form.js): nombres libres, decimales, ±(2^53 - 0,6).
-- M-14: ±(2^53 - 0,5) ya no entra (JSON.parse lo lee como ±2^53).
select lives_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category)
     values ('FX_QA_M12_N2', 'x', 'window_average', 'lower_is_better', 5, 10,
             '{"Critica / alta-1": {"green": 2.5, "yellow": 7.25}, "baja_2": {"green": 0, "yellow": 9007199254740991.4}}') $$,
  'gestora: INSERT con categorías de nombre libre y decimales (forma del formulario) aceptado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category)
     values ('FX_QA_M12_N3', 'x', 'window_average', 'lower_is_better', 5, 10,
             '{"Critica / alta-1": {"green": 2.5, "yellow": 7.25}, "baja_2": {"green": 0, "yellow": 9007199254740991.5}}') $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: INSERT con yellow 2^53 - 0,5 en la segunda categoría rechazado (M-14)');
select lives_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"yellow": -9007199254740991.4, "green": 9007199254740991.4}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  'gestora: ±(2^53 - 0,6) y claves en otro orden aceptados');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"yellow": -9007199254740991.5, "green": 96}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: yellow -(2^53 - 0,5) con claves en otro orden rechazado (M-14)');
select lives_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 75}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  'gestora: restaura los umbrales por categoría');

-- Roles que no escriben indicators: siguen sin escribir, aun con forma válida.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001212","role":"authenticated"}';
select is_empty(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 1, "yellow": 0}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' returning id $$,
  'custodio: no actualiza thresholds_by_category de su indicador (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001214","role":"authenticated"}';
select is_empty(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 1, "yellow": 0}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' returning id $$,
  'líder: no actualiza thresholds_by_category (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001215","role":"authenticated"}';
select is_empty(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 1, "yellow": 0}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' returning id $$,
  'comité: no actualiza thresholds_by_category (RLS)');
reset role;
set local role anon;
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 1, "yellow": 0}}'
      where id = 'cccccccc-0000-4000-8000-000000001211' $$,
  '42501', null, 'anónimo: no actualiza indicators');
reset role;
select is((select thresholds_by_category from public.indicators where id = 'cccccccc-0000-4000-8000-000000001211'),
  '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 75}}'::jsonb,
  'indicators: quedan los umbrales por categoría válidos de la gestora');

-- ---------------------------------------------------------------------------
-- measurements.value: escribe el custodio de su indicador
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001212","role":"authenticated"}';
select throws_ok(
  $$ update public.measurements set value = 9007199254740992 where id = 'eeeeeeee-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: UPDATE de un promedio a 2^53 rechazado');
select throws_ok(
  $$ update public.measurements set value = '1e400' where id = 'eeeeeeee-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: UPDATE de un promedio a 1e400 rechazado');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001211', 'cccccccc-0000-4000-8000-000000001212', '2034-01-06', '9.007199254740992e15') $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: INSERT 2^53 en notación exponencial rechazado');
select lives_ok(
  $$ update public.measurements set value = 9007199254740991.4 where id = 'eeeeeeee-0000-4000-8000-000000001211' $$,
  'custodio: UPDATE de un promedio a 2^53 - 0,6 aceptado (tope estricto, sin exigir entero)');
select throws_ok(
  $$ update public.measurements set value = 9007199254740991.5 where id = 'eeeeeeee-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: UPDATE de un promedio a 2^53 - 0,5 rechazado (M-14)');
select lives_ok(
  $$ update public.measurements set value = 99.9 where id = 'eeeeeeee-0000-4000-8000-000000001211' $$,
  'custodio: UPDATE de un promedio a un valor normal aceptado');
-- Meta acumulada con categorías: 2^53 sigue rechazado (CHECK o el guardia de M-09).
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category)
     values ('bbbbbbbb-0000-4000-8000-000000001211', 'cccccccc-0000-4000-8000-000000001211', '2034-01-06', 9007199254740992, 'P0P1') $$,
  '23514', null, 'custodio: 2^53 en meta acumulada con categorías sigue rechazado');
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category)
     values ('bbbbbbbb-0000-4000-8000-000000001211', 'cccccccc-0000-4000-8000-000000001211', '2034-01-06', 9007199254740991, 'P0P1') $$,
  'custodio: 2^53 - 1 en meta acumulada con categorías aceptado');

-- Roles que no escriben esas mediciones (con valor válido).
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001213","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001211', 'cccccccc-0000-4000-8000-000000001212', '2034-01-07', 99.9) $$,
  '42501', null, 'custodio ajeno: no inserta mediciones de otro indicador (RLS)');
select is_empty(
  $$ update public.measurements set value = 1 where id = 'eeeeeeee-0000-4000-8000-000000001211' returning id $$,
  'custodio ajeno: no actualiza mediciones de otro indicador (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001214","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001211', 'cccccccc-0000-4000-8000-000000001212', '2034-01-07', 99.9) $$,
  '42501', null, 'líder: no inserta mediciones (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001211","role":"authenticated"}';
select is_empty(
  $$ update public.measurements set value = 1 where id = 'eeeeeeee-0000-4000-8000-000000001211' returning id $$,
  'gestora: no actualiza mediciones (RLS)');
reset role;
select is((select value from public.measurements where id = 'eeeeeeee-0000-4000-8000-000000001211'), 99.9::numeric,
  'measurements: queda el último valor válido del custodio');

-- ---------------------------------------------------------------------------
-- commitments.package_by_category: escribe el custodio de su indicador
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001212","role":"authenticated"}';
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_by_category, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000001211', 'cccccccc-0000-4000-8000-000000001211', '2034-Q2',
             '{"P0P1": 100, "P2P3": -1}', 'aaaaaaaa-0000-4000-8000-000000001212') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'custodio: INSERT con -1 en la segunda clave rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 200, "P2P3": 0.5}'
      where id = 'dddddddd-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'custodio: 0,5 en la segunda clave rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": -0.5}'
      where id = 'dddddddd-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'custodio: -0,5 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9007199254740990.5}'
      where id = 'dddddddd-0000-4000-8000-000000001211' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'custodio: 2^53 - 1,5 (fracción bajo el tope) rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": true}'
      where id = 'dddddddd-0000-4000-8000-000000001211' $$,
  '23514', null, 'custodio: booleano sigue rechazado');
select lives_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1.0, "P2P3": 1e2}'
      where id = 'dddddddd-0000-4000-8000-000000001211' $$,
  'custodio: enteros escritos como 1.0 y 1e2 aceptados (JSON.parse los lee enteros)');
select lives_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_total, package_by_category, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000001211', 'cccccccc-0000-4000-8000-000000001211', '2034-Q3',
             10, '{"Critica / alta-1": 10, "total": 0}', 'aaaaaaaa-0000-4000-8000-000000001212') $$,
  'custodio: INSERT con claves libres y "total" (las del formulario) aceptado');
select lives_ok(
  $$ update public.commitments set package_by_category = '{}' where id = 'dddddddd-0000-4000-8000-000000001211' $$,
  'custodio: paquete vacío aceptado');
select lives_ok(
  $$ update public.commitments set package_by_category = null where id = 'dddddddd-0000-4000-8000-000000001211' $$,
  'custodio: paquete NULL aceptado');
select lives_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 200, "P2P3": 100}'
      where id = 'dddddddd-0000-4000-8000-000000001211' $$,
  'custodio: restaura el paquete');

-- Roles que no escriben ese compromiso (con valor válido).
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001213","role":"authenticated"}';
select is_empty(
  $$ update public.commitments set package_by_category = '{"P0P1": 1}'
      where id = 'dddddddd-0000-4000-8000-000000001211' returning id $$,
  'custodio ajeno: no actualiza package_by_category (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001211","role":"authenticated"}';
select is_empty(
  $$ update public.commitments set package_by_category = '{"P0P1": 1}'
      where id = 'dddddddd-0000-4000-8000-000000001211' returning id $$,
  'gestora: no actualiza package_by_category (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001215","role":"authenticated"}';
select is_empty(
  $$ update public.commitments set package_by_category = '{"P0P1": 1}'
      where id = 'dddddddd-0000-4000-8000-000000001211' returning id $$,
  'comité: no actualiza package_by_category (RLS)');
reset role;
select is((select package_by_category from public.commitments where id = 'dddddddd-0000-4000-8000-000000001211'),
  '{"P0P1": 200, "P2P3": 100}'::jsonb, 'commitments: queda el último paquete válido del custodio');

-- ---------------------------------------------------------------------------
-- Verificación previa a producción: las consultas comentadas de la migración, tal cual.
-- 1) Sobre la semilla y lo que dejó esta prueba: 0 filas.
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select id, code, thresholds_by_category from public.indicators
      where jsonb_typeof(thresholds_by_category) <> 'object'
         or jsonb_path_exists(thresholds_by_category, 'strict $.* ? (@.type() != "object")')
         or jsonb_path_exists(thresholds_by_category,
              'strict $.* ? (@.type() == "object").keyvalue() ? (@.key != "green" && @.key != "yellow")')
         or jsonb_path_exists(thresholds_by_category,
              'lax $.* ? (@.type() == "object") ? (!exists(@.green) || !exists(@.yellow))')
         or jsonb_path_exists(thresholds_by_category,
              'strict $.* ? (@.type() == "object").* ? (@.type() != "number" || @.abs() >= 9007199254740992)') $$,
  'verificación previa: indicators sin filas fuera de forma');
select is_empty(
  $$ select id, indicator_id, measured_on, value from public.measurements
      where not (abs(value) < 9007199254740992) $$,
  'verificación previa: measurements sin filas fuera del tope');
select is_empty(
  $$ select id, package_by_category from public.commitments
      where jsonb_typeof(package_by_category) <> 'object'
         or jsonb_path_exists(package_by_category,
              'strict $.* ? (@.type() != "number" || @ < 0 || @ != @.floor())') $$,
  'verificación previa: commitments sin paquetes no enteros');

-- 2) Las mismas consultas detectan filas malas: se quitan los CHECK dentro de esta transacción
--    (se revierte al final), se cargan filas como las que había antes de M-12 y se cuentan.
alter table public.indicators drop constraint indicators_thresholds_by_category_safe;
alter table public.measurements drop constraint measurements_value_safe;
alter table public.commitments drop constraint commitments_package_by_category_whole;
update public.indicators set thresholds_by_category = '{"P0P1": {"green": 1e400, "yellow": 90}}'
 where id = 'cccccccc-0000-4000-8000-000000001211';
update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96}}'
 where id = 'cccccccc-0000-4000-8000-000000001212';
update public.indicators set thresholds_by_category = '{"P0P1": 96}'
 where id = 'cccccccc-0000-4000-8000-000000001213';
update public.measurements set value = 1e300 where id = 'eeeeeeee-0000-4000-8000-000000001211';
update public.commitments set package_by_category = '{"P0P1": 1.5, "P2P3": -5}'
 where id = 'dddddddd-0000-4000-8000-000000001211';
select is(
  (select count(*)::int from public.indicators
    where jsonb_typeof(thresholds_by_category) <> 'object'
       or jsonb_path_exists(thresholds_by_category, 'strict $.* ? (@.type() != "object")')
       or jsonb_path_exists(thresholds_by_category,
            'strict $.* ? (@.type() == "object").keyvalue() ? (@.key != "green" && @.key != "yellow")')
       or jsonb_path_exists(thresholds_by_category,
            'lax $.* ? (@.type() == "object") ? (!exists(@.green) || !exists(@.yellow))')
       or jsonb_path_exists(thresholds_by_category,
            'strict $.* ? (@.type() == "object").* ? (@.type() != "number" || @.abs() >= 9007199254740992)')),
  3, 'verificación previa: detecta los 3 indicadores con umbral 1e400, sin yellow y escalar');
select is(
  (select count(*)::int from public.measurements where not (abs(value) < 9007199254740992)),
  1, 'verificación previa: detecta la medición 1e300');
select is(
  (select count(*)::int from public.commitments
    where jsonb_typeof(package_by_category) <> 'object'
       or jsonb_path_exists(package_by_category,
            'strict $.* ? (@.type() != "number" || @ < 0 || @ != @.floor())')),
  1, 'verificación previa: detecta el paquete con fracción y negativo');

select * from finish();
rollback;
