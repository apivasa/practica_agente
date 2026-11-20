-- M-10 (pruebas del desarrollador, H-M09-01): las columnas numeric configurables por usuarios
-- rechazan 'NaN', 'Infinity' y '-Infinity'; los valores finitos (y NULL donde se permite) pasan.
begin;
select plan(24);

insert into public.units (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000001001', 'FX M10 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('cccccccc-0000-4000-8000-000000001001', 'FX_M10_BASE', 'FX M10 base', 'window_average', 'higher_is_better', 95, 90);

-- indicators: umbrales. Cada caso cumple indicators_thresholds_coherent, así que solo falla
-- el CHECK de valor finito.
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M10_G1', 'x', 'window_average', 'higher_is_better', 'NaN', 90) $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_finite"',
  'indicators: green_threshold NaN rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M10_G2', 'x', 'window_average', 'higher_is_better', 'Infinity', 90) $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_finite"',
  'indicators: green_threshold Infinity rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M10_G3', 'x', 'window_average', 'lower_is_better', '-Infinity', 90) $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_finite"',
  'indicators: green_threshold -Infinity rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M10_Y1', 'x', 'window_average', 'lower_is_better', 90, 'NaN') $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_finite"',
  'indicators: yellow_threshold NaN rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M10_Y2', 'x', 'window_average', 'lower_is_better', 90, 'Infinity') $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_finite"',
  'indicators: yellow_threshold Infinity rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M10_Y3', 'x', 'window_average', 'higher_is_better', 90, '-Infinity') $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_finite"',
  'indicators: yellow_threshold -Infinity rechazado');
select throws_ok(
  $$ update public.indicators set green_threshold = 'NaN' where id = 'cccccccc-0000-4000-8000-000000001001' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_finite"',
  'indicators: UPDATE a NaN rechazado');
select lives_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_M10_OK', 'x', 'window_average', 'higher_is_better', 99.9, 99.5) $$,
  'indicators: umbrales finitos aceptados');

-- commitments: overrides (en pareja) y paquete.
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', 'NaN', 5) $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_finite"',
  'commitments: green_override NaN rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', 'Infinity', 5) $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_finite"',
  'commitments: green_override Infinity rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', '-Infinity', 5) $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_finite"',
  'commitments: green_override -Infinity rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', 5, 'NaN') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_yellow_override_finite"',
  'commitments: yellow_override NaN rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', 5, 'Infinity') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_yellow_override_finite"',
  'commitments: yellow_override Infinity rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', 5, '-Infinity') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_yellow_override_finite"',
  'commitments: yellow_override -Infinity rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_total)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', 'NaN') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_total_finite"',
  'commitments: package_total NaN rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_total)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', 'Infinity') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_total_finite"',
  'commitments: package_total Infinity rechazado');
-- -Infinity también viola el CHECK original package_total >= 0: basta con el código.
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_total)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', '-Infinity') $$,
  '23514', null, 'commitments: package_total -Infinity rechazado');
select lives_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override, package_total)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', 97.5, 92, 120) $$,
  'commitments: overrides y paquete finitos aceptados');
select lives_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override, package_total)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-02', null, null, null) $$,
  'commitments: NULL sigue permitido en overrides y paquete');

-- targets: target_value.
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', 'NaN') $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_finite"',
  'targets: target_value NaN rechazado');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', 'Infinity') $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_finite"',
  'targets: target_value Infinity rechazado');
-- -Infinity también viola el CHECK original target_value >= 0: basta con el código.
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', '-Infinity') $$,
  '23514', null, 'targets: target_value -Infinity rechazado');
select lives_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001001', 'cccccccc-0000-4000-8000-000000001001', '2031-01', 10.5) $$,
  'targets: target_value finito aceptado');
select throws_ok(
  $$ update public.targets set target_value = 'NaN'
      where unit_id = 'bbbbbbbb-0000-4000-8000-000000001001' and month = '2031-01' $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_finite"',
  'targets: UPDATE a NaN rechazado');

select * from finish();
rollback;
