-- M-11 (pruebas del desarrollador, H-M10-01): las columnas numeric configurables y cada valor
-- de commitments.package_by_category rechazan magnitudes >= 2^53 (p. ej. '1e400', que JSON.parse
-- convierte en Infinity); 2^53 - 1 y los valores normales pasan.
begin;
select plan(26);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000001101', 'fx-m11-custodio@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000001101', 'FX M11 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('cccccccc-0000-4000-8000-000000001101', 'FX_M11_BASE', 'FX M11 base', 'cumulative_target', 'higher_is_better', 95, 90);
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('aaaaaaaa-0000-4000-8000-000000001101', 'custodian', null, 'cccccccc-0000-4000-8000-000000001101');
insert into public.commitments (id, unit_id, indicator_id, period, package_total, package_by_category) values
  ('dddddddd-0000-4000-8000-000000001101', 'bbbbbbbb-0000-4000-8000-000000001101', 'cccccccc-0000-4000-8000-000000001101',
   '2031-Q1', 300, '{"P0P1": 200, "P2P3": 100}');

-- indicators: umbrales (cada caso es coherente con la dirección, solo falla el tope).
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M11_G1', 'x', 'window_average', 'higher_is_better', '1e400', 90) $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'indicators: green_threshold 1e400 rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M11_G2', 'x', 'window_average', 'lower_is_better', '-1e400', 90) $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'indicators: green_threshold -1e400 rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M11_Y1', 'x', 'window_average', 'lower_is_better', 90, '1e400') $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_safe"',
  'indicators: yellow_threshold 1e400 rechazado');
select throws_ok(
  $$ update public.indicators set green_threshold = 9007199254740992 where id = 'cccccccc-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'indicators: UPDATE a 2^53 rechazado');
select lives_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M11_OK', 'x', 'window_average', 'higher_is_better', 9007199254740991, -9007199254740991) $$,
  'indicators: umbrales en ±(2^53 - 1) aceptados');

-- commitments: overrides (en pareja) y paquete total.
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override)
     values ('bbbbbbbb-0000-4000-8000-000000001101', 'cccccccc-0000-4000-8000-000000001101', '2031-01', '1e400', 5) $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_safe"',
  'commitments: green_override 1e400 rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override)
     values ('bbbbbbbb-0000-4000-8000-000000001101', 'cccccccc-0000-4000-8000-000000001101', '2031-01', 5, '-1e400') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_yellow_override_safe"',
  'commitments: yellow_override -1e400 rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_total)
     values ('bbbbbbbb-0000-4000-8000-000000001101', 'cccccccc-0000-4000-8000-000000001101', '2031-01', '1e400') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_total_safe"',
  'commitments: package_total 1e400 rechazado');
select throws_ok(
  $$ update public.commitments set package_total = 9007199254740992 where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_total_safe"',
  'commitments: UPDATE package_total a 2^53 rechazado');
select lives_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override, package_total)
     values ('bbbbbbbb-0000-4000-8000-000000001101', 'cccccccc-0000-4000-8000-000000001101', '2031-01',
             9007199254740991, -9007199254740991, 9007199254740991) $$,
  'commitments: overrides y paquete en ±(2^53 - 1) aceptados');

-- commitments.package_by_category: por clave.
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1e400, "P2P3": 100}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: P0P1 1e400 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 200, "P2P3": 1e400}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: P2P3 1e400 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": -1e400}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: -1e400 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9007199254740992}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: 2^53 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": "1e400"}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: texto rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": null}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: null como valor rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": [1e400]}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: arreglo rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": {"x": 1e400}}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: objeto anidado rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": true}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: booleano rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_by_category)
     values ('bbbbbbbb-0000-4000-8000-000000001101', 'cccccccc-0000-4000-8000-000000001101', '2031-Q2', '{"P0P1": 1e400}') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: INSERT con 1e400 rechazado');
select lives_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9007199254740991, "P2P3": 0}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  'package_by_category: 2^53 - 1 y 0 aceptados');
select lives_ok(
  $$ update public.commitments set package_by_category = '{}' where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  'package_by_category: objeto vacío aceptado');
select lives_ok(
  $$ update public.commitments set package_by_category = null where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  'package_by_category: NULL aceptado');

-- Vía real de escritura: el custodio (authenticated, RLS) llega al mismo CHECK sin permisos extra.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001101","role":"authenticated"}';
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1e400, "P2P3": 100}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: package_by_category 1e400 rechazado');
select lives_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 200, "P2P3": 100}'
      where id = 'dddddddd-0000-4000-8000-000000001101' $$,
  'custodio: package_by_category normal aceptado');
reset role;

-- targets: target_value.
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001101', 'cccccccc-0000-4000-8000-000000001101', '2031-01', '1e400') $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'targets: target_value 1e400 rechazado');

select * from finish();
rollback;
