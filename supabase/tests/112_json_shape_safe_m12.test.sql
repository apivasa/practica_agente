-- M-12 (pruebas del desarrollador, H-M11-01..03):
--  * indicators.thresholds_by_category: objeto de objetos { green, yellow } numéricos con |v| < 2^53.
--  * measurements.value: |v| < 2^53 también sin categorías.
--  * commitments.package_by_category: cada valor entero >= 0 (las claves siguen libres).
begin;
select plan(31);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000001201', 'fx-m12-gestora@example.test',  'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001202', 'fx-m12-custodio@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000001201', 'FX M12 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category) values
  ('cccccccc-0000-4000-8000-000000001201', 'FX_M12_CUM', 'FX M12 acumulado', 'cumulative_target', 'higher_is_better', 96, 90,
   '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 75}}'),
  ('cccccccc-0000-4000-8000-000000001202', 'FX_M12_AVG', 'FX M12 promedio', 'window_average', 'higher_is_better', 99.9, 99.5, '{}');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('aaaaaaaa-0000-4000-8000-000000001201', 'kpi_manager', null, null),
  ('aaaaaaaa-0000-4000-8000-000000001202', 'custodian',   null, 'cccccccc-0000-4000-8000-000000001201'),
  ('aaaaaaaa-0000-4000-8000-000000001202', 'custodian',   null, 'cccccccc-0000-4000-8000-000000001202');
insert into public.commitments (id, unit_id, indicator_id, period, package_total, package_by_category) values
  ('dddddddd-0000-4000-8000-000000001201', 'bbbbbbbb-0000-4000-8000-000000001201', 'cccccccc-0000-4000-8000-000000001201',
   '2031-Q1', 300, '{"P0P1": 200, "P2P3": 100}');

-- Catálogo: los tres CHECK existen y están validados.
select is(
  (select count(*)::int from pg_constraint
    where contype = 'c' and convalidated
      and conname in ('indicators_thresholds_by_category_safe', 'measurements_value_safe',
                      'commitments_package_by_category_whole')),
  3, 'los 3 CHECK de M-12 existen y están validados');

-- H-M11-01: thresholds_by_category -------------------------------------------------------
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 1e400, "yellow": 90}}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'umbrales por categoría: green 1e400 rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96, "yellow": -9007199254740992}}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'umbrales por categoría: yellow -2^53 rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": "96", "yellow": 90}}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'umbrales por categoría: número como texto rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": null, "yellow": 90}}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'umbrales por categoría: null como umbral rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96}}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'umbrales por categoría: falta yellow rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {}}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'umbrales por categoría: objeto vacío como categoría rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96, "yellow": 90, "red": 1}}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'umbrales por categoría: clave extra rechazada');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": 96}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'umbrales por categoría: valor escalar (no objeto) rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": [{"green": 96, "yellow": 90}]}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'umbrales por categoría: arreglo como categoría rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": [96], "yellow": 90}}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'umbrales por categoría: arreglo como umbral rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '[]'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', null, 'umbrales por categoría: arreglo en la raíz rechazado con 23514 (no error de jsonpath)');
select lives_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 9007199254740991, "yellow": -9007199254740991}, "Otra cat": {"green": 99.5, "yellow": 0}}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  'umbrales por categoría: ±(2^53 - 1), decimales y nombres libres aceptados');
select lives_ok(
  $$ update public.indicators set thresholds_by_category = '{}' where id = 'cccccccc-0000-4000-8000-000000001202' $$,
  'umbrales por categoría: objeto vacío aceptado');

-- Vía real: la gestora (authenticated, RLS).
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001201","role":"authenticated"}';
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 1e400, "yellow": 90}}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: umbral por categoría 1e400 rechazado');
select lives_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 75}}'
      where id = 'cccccccc-0000-4000-8000-000000001201' $$,
  'gestora: umbrales por categoría normales aceptados');
reset role;

-- H-M11-02: measurements.value -----------------------------------------------------------
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001201', 'cccccccc-0000-4000-8000-000000001202', '2031-01-10', '1e400') $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'mediciones: 1e400 en un promedio rechazado');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001201', 'cccccccc-0000-4000-8000-000000001202', '2031-01-10', 9007199254740992) $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'mediciones: 2^53 en un promedio rechazado');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001201', 'cccccccc-0000-4000-8000-000000001202', '2031-01-10', 'NaN') $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_finite"',
  'mediciones: NaN sigue frenado por el CHECK de finitud de M-09');
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001201', 'cccccccc-0000-4000-8000-000000001202', '2031-01-10', 9007199254740991.4) $$,
  'mediciones: 9007199254740991.4 en un promedio aceptado (no exige entero; borde de M-14)');
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001201', 'cccccccc-0000-4000-8000-000000001202', '2031-01-11', null) $$,
  'mediciones: valor NULL aceptado');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001202","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001201', 'cccccccc-0000-4000-8000-000000001202', '2031-01-12', 1e308) $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: 1e308 en un promedio rechazado');
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001201', 'cccccccc-0000-4000-8000-000000001202', '2031-01-12', 99.9) $$,
  'custodio: medición normal aceptada');
reset role;

-- H-M11-03: package_by_category entero >= 0 ----------------------------------------------
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": -5, "P2P3": 100}'
      where id = 'dddddddd-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'paquete: negativo rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1.5}'
      where id = 'dddddddd-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'paquete: fracción rechazada');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1e-16000}'
      where id = 'dddddddd-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'paquete: magnitud diminuta (1e-16000) rechazada');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9007199254740991.4}'
      where id = 'dddddddd-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'paquete: 9007199254740991.4 rechazado por no ser entero (9007199254740991.9999 ya lo frena el tope de M-14)');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1e400}'
      where id = 'dddddddd-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'paquete: 1e400 sigue reportando el CHECK de M-11');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001202","role":"authenticated"}';
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 200, "P2P3": -1}'
      where id = 'dddddddd-0000-4000-8000-000000001201' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'custodio: paquete negativo rechazado');
select lives_ok(
  $$ update public.commitments set package_by_category = '{"total": 30}'
      where id = 'dddddddd-0000-4000-8000-000000001201' $$,
  'custodio: clave "total" (meta acumulada sin categorías, como el formulario) aceptada');
select lives_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9007199254740991, "P2P3": 0}'
      where id = 'dddddddd-0000-4000-8000-000000001201' $$,
  'custodio: paquete 2^53 - 1 y 0 aceptado');
reset role;

select * from finish();
rollback;
