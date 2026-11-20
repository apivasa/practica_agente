-- M-14 (pruebas del desarrollador, H-ARQ-M13-01): los CHECK `_safe` usan |v| < 2^53 - 0,5
-- (9007199254740991.5), el borde en el que JSON.parse empieza a redondear a 2^53.
-- 9007199254740991.4 pasa (JS lo lee como 2^53 - 1) y 9007199254740991.5 se rechaza (JS lo lee
-- como 2^53), en cada columna y en cada clave JSONB; simétrico en negativos donde el dominio
-- los admite.
begin;
select plan(48);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000001401', 'fx-m14-gestora@example.test',  'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001402', 'fx-m14-custodio@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000001401', 'FX M14 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('cccccccc-0000-4000-8000-000000001401', 'FX_M14_HI', 'FX M14 más es mejor',  'window_average', 'higher_is_better', 95, 90),
  ('cccccccc-0000-4000-8000-000000001402', 'FX_M14_LO', 'FX M14 menos es mejor', 'window_average', 'lower_is_better', 90, 100);
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('aaaaaaaa-0000-4000-8000-000000001401', 'kpi_manager', null, null),
  ('aaaaaaaa-0000-4000-8000-000000001402', 'custodian',   null, 'cccccccc-0000-4000-8000-000000001401');
insert into public.commitments (id, unit_id, indicator_id, period, package_total, package_by_category) values
  ('dddddddd-0000-4000-8000-000000001401', 'bbbbbbbb-0000-4000-8000-000000001401', 'cccccccc-0000-4000-8000-000000001401',
   '2031-Q1', 300, '{"P0P1": 200, "P2P3": 100}');
insert into public.measurements (id, unit_id, indicator_id, measured_on, value) values
  ('eeeeeeee-0000-4000-8000-000000001401', 'bbbbbbbb-0000-4000-8000-000000001401', 'cccccccc-0000-4000-8000-000000001401',
   '2031-01-05', 99);

-- Catálogo: los 11 CHECK conservan su nombre, están validados y usan el borde nuevo.
select is(
  (select count(*)::int from pg_constraint
    where contype = 'c' and convalidated
      and conname in ('indicators_green_threshold_safe', 'indicators_yellow_threshold_safe',
                      'indicators_thresholds_by_category_safe',
                      'commitments_green_override_safe', 'commitments_yellow_override_safe',
                      'commitments_package_total_safe', 'commitments_package_by_category_safe',
                      'targets_target_value_safe', 'measurements_value_safe')
      and pg_get_constraintdef(oid) like '%9007199254740991.5%'
      and pg_get_constraintdef(oid) not like '%9007199254740992%'),
  9, 'los 9 CHECK _safe existen, validados, con tope 9007199254740991.5 y sin 2^53');

-- indicators.green_threshold / yellow_threshold ---------------------------------------------
select lives_ok(
  $$ update public.indicators set green_threshold = 9007199254740991.4 where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  'green_threshold: 9007199254740991.4 aceptado');
select throws_ok(
  $$ update public.indicators set green_threshold = 9007199254740991.5 where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'green_threshold: 9007199254740991.5 rechazado');
select lives_ok(
  $$ update public.indicators set green_threshold = -9007199254740991.4 where id = 'cccccccc-0000-4000-8000-000000001402' $$,
  'green_threshold: -9007199254740991.4 aceptado');
select throws_ok(
  $$ update public.indicators set green_threshold = -9007199254740991.5 where id = 'cccccccc-0000-4000-8000-000000001402' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'green_threshold: -9007199254740991.5 rechazado');
select lives_ok(
  $$ update public.indicators set yellow_threshold = 9007199254740991.4 where id = 'cccccccc-0000-4000-8000-000000001402' $$,
  'yellow_threshold: 9007199254740991.4 aceptado');
select throws_ok(
  $$ update public.indicators set yellow_threshold = 9007199254740991.5 where id = 'cccccccc-0000-4000-8000-000000001402' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_safe"',
  'yellow_threshold: 9007199254740991.5 rechazado');
select lives_ok(
  $$ update public.indicators set yellow_threshold = -9007199254740991.4 where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  'yellow_threshold: -9007199254740991.4 aceptado');
select throws_ok(
  $$ update public.indicators set yellow_threshold = -9007199254740991.5 where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_safe"',
  'yellow_threshold: -9007199254740991.5 rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M14_INS', 'x', 'window_average', 'higher_is_better', 9007199254740991.5, 90) $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'green_threshold: INSERT con 9007199254740991.5 rechazado');

-- indicators.thresholds_by_category: green y yellow de cada categoría ------------------------
select lives_ok(
  $$ update public.indicators set thresholds_by_category =
       '{"P0P1": {"green": 9007199254740991.4, "yellow": -9007199254740991.4}, "P2P3": {"green": -9007199254740991.4, "yellow": 9007199254740991.4}}'
      where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  'thresholds_by_category: ±9007199254740991.4 en green y yellow de dos categorías aceptado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 9007199254740991.5, "yellow": 90}}'
      where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'thresholds_by_category: green 9007199254740991.5 rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": -9007199254740991.5, "yellow": 90}}'
      where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'thresholds_by_category: green -9007199254740991.5 rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96, "yellow": 9007199254740991.5}}'
      where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'thresholds_by_category: yellow 9007199254740991.5 rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96, "yellow": -9007199254740991.5}}'
      where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'thresholds_by_category: yellow -9007199254740991.5 rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category =
       '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 9007199254740991.5, "yellow": 75}}'
      where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'thresholds_by_category: 9007199254740991.5 en la segunda categoría rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96}}'
      where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'thresholds_by_category: la forma de M-12 se conserva (falta yellow, rechazado)');

-- commitments.green_override / yellow_override (van en pareja) -------------------------------
select lives_ok(
  $$ update public.commitments set green_override = 9007199254740991.4, yellow_override = -9007199254740991.4
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  'overrides: green 9007199254740991.4 y yellow -9007199254740991.4 aceptados');
select lives_ok(
  $$ update public.commitments set green_override = -9007199254740991.4, yellow_override = 9007199254740991.4
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  'overrides: green -9007199254740991.4 y yellow 9007199254740991.4 aceptados');
select throws_ok(
  $$ update public.commitments set green_override = 9007199254740991.5, yellow_override = 5
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_safe"',
  'green_override: 9007199254740991.5 rechazado');
select throws_ok(
  $$ update public.commitments set green_override = -9007199254740991.5, yellow_override = 5
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_safe"',
  'green_override: -9007199254740991.5 rechazado');
select throws_ok(
  $$ update public.commitments set green_override = 5, yellow_override = 9007199254740991.5
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_yellow_override_safe"',
  'yellow_override: 9007199254740991.5 rechazado');
select throws_ok(
  $$ update public.commitments set green_override = 5, yellow_override = -9007199254740991.5
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_yellow_override_safe"',
  'yellow_override: -9007199254740991.5 rechazado');

-- commitments.package_total (>= 0) ----------------------------------------------------------
select lives_ok(
  $$ update public.commitments set package_total = 9007199254740991.4 where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  'package_total: 9007199254740991.4 aceptado');
select throws_ok(
  $$ update public.commitments set package_total = 9007199254740991.5 where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_total_safe"',
  'package_total: 9007199254740991.5 rechazado');

-- commitments.package_by_category: cada clave. El tope `_safe` se evalúa antes que `_whole`
-- (orden por nombre): con .4 el que reporta es `_whole` (pasó el tope, falla por no ser
-- entero); con .5 reporta `_safe`.
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9007199254740991.4, "P2P3": 100}'
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'package_by_category: P0P1 9007199254740991.4 pasa el tope (lo frena _whole por no ser entero)');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 200, "P2P3": 9007199254740991.4}'
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_whole"',
  'package_by_category: P2P3 9007199254740991.4 pasa el tope (lo frena _whole por no ser entero)');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9007199254740991.5, "P2P3": 100}'
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: P0P1 9007199254740991.5 rechazado por el tope');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 200, "P2P3": 9007199254740991.5}'
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: P2P3 9007199254740991.5 rechazado por el tope');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"total": -9007199254740991.5}'
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: clave libre con -9007199254740991.5 rechazada por el tope');
select lives_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9007199254740991, "P2P3": 0}'
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  'package_by_category: 2^53 - 1 (entero exacto en double) aceptado');
select ok(
  not jsonb_path_exists('{"P0P1": 9007199254740991.4, "P2P3": -9007199254740991.4}'::jsonb,
    'strict $.* ? (@.type() != "number" || @.abs() >= 9007199254740991.5)')
  and jsonb_path_exists('{"P0P1": 1, "P2P3": 9007199254740991.5}'::jsonb,
    'strict $.* ? (@.type() != "number" || @.abs() >= 9007199254740991.5)'),
  'jsonpath del tope: ±.4 no se selecciona y .5 sí (comparación numeric exacta)');

-- targets.target_value (>= 0) ---------------------------------------------------------------
select lives_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001401', 'cccccccc-0000-4000-8000-000000001401', '2031-01', 9007199254740991.4) $$,
  'target_value: 9007199254740991.4 aceptado');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001401', 'cccccccc-0000-4000-8000-000000001401', '2031-02', 9007199254740991.5) $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'target_value: 9007199254740991.5 rechazado');
select throws_ok(
  $$ update public.targets set target_value = 9007199254740991.5
      where unit_id = 'bbbbbbbb-0000-4000-8000-000000001401' and month = '2031-01' $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'target_value: UPDATE a 9007199254740991.5 rechazado');

-- measurements.value (>= 0; indicador sin categorías) ----------------------------------------
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001401', 'cccccccc-0000-4000-8000-000000001401', '2031-01-10', 9007199254740991.4) $$,
  'measurements.value: 9007199254740991.4 aceptado');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001401', 'cccccccc-0000-4000-8000-000000001401', '2031-01-11', 9007199254740991.5) $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'measurements.value: 9007199254740991.5 rechazado');
select throws_ok(
  $$ update public.measurements set value = 9007199254740991.5 where id = 'eeeeeeee-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'measurements.value: UPDATE a 9007199254740991.5 rechazado');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001401', 'cccccccc-0000-4000-8000-000000001401', '2031-01-12', 'NaN') $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_finite"',
  'measurements.value: NaN sigue frenado por el CHECK de finitud de M-09');

-- Vía real de escritura: gestora y custodio (authenticated, RLS) llegan al mismo CHECK.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001401","role":"authenticated"}';
select throws_ok(
  $$ update public.indicators set green_threshold = 9007199254740991.5 where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'gestora: green_threshold 9007199254740991.5 rechazado');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96, "yellow": 9007199254740991.5}}'
      where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'gestora: thresholds_by_category con 9007199254740991.5 rechazado');
select lives_ok(
  $$ update public.indicators set green_threshold = 9007199254740991.4 where id = 'cccccccc-0000-4000-8000-000000001401' $$,
  'gestora: green_threshold 9007199254740991.4 aceptado');
select throws_ok(
  $$ update public.targets set target_value = 9007199254740991.5
      where unit_id = 'bbbbbbbb-0000-4000-8000-000000001401' and month = '2031-01' $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'gestora: target_value 9007199254740991.5 rechazado');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001402","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001401', 'cccccccc-0000-4000-8000-000000001401', '2031-01-13', 9007199254740991.5) $$,
  '23514', 'new row for relation "measurements" violates check constraint "measurements_value_safe"',
  'custodio: medición 9007199254740991.5 rechazada');
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001401', 'cccccccc-0000-4000-8000-000000001401', '2031-01-14', 9007199254740991.4) $$,
  'custodio: medición 9007199254740991.4 aceptada');
select throws_ok(
  $$ update public.commitments set package_total = 9007199254740991.5 where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_total_safe"',
  'custodio: package_total 9007199254740991.5 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9007199254740991.5}'
      where id = 'dddddddd-0000-4000-8000-000000001401' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: package_by_category 9007199254740991.5 rechazado');
reset role;

select is((select value from public.measurements where id = 'eeeeeeee-0000-4000-8000-000000001401'), 99::numeric,
  'la medición conserva su valor tras los UPDATE rechazados');

select * from finish();
rollback;
