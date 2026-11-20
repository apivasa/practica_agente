-- QA M-11 (H-M10-01): casos que no cubren las pruebas del desarrollador (110).
-- Trazas:
--  - plan-maestro M-11: "pgTAP con '1e400' por columna y por clave JSONB" -> también por la vía
--    real de escritura (authenticated con RLS: gestora en indicators y targets, custodio en
--    commitments), por INSERT y UPDATE, y con 1e300 (finito, no tocado por M-10, ahora fuera).
--  - plan-maestro M-11: "tope |v| < 2^53" -> borde exacto: ±2^53 rechazado, ±(2^53 - 1) y
--    2^53 - 0.5 aceptados (estricto <), en las siete restricciones; 2^53 en notación exponencial.
--  - plan-maestro M-11: "cada valor de package_by_category sea número JSON finito" -> el valor
--    malo en cualquier clave (no solo la primera), texto numérico, claves extra; un
--    package_by_category que no es objeto sigue rechazado con 23514 (no con un error de jsonpath).
--  - migración M-11: "La semilla cumple" / "verificación previa" -> restricciones validadas y
--    las consultas comentadas devuelven 0 filas sobre la semilla.
--  - CLAUDE.md 4: prueba por rol -> los roles que no escriben la tabla siguen sin escribirla con
--    un valor válido (el CHECK no reemplaza ni rompe RLS); NaN sigue rechazado.
begin;
select plan(41);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000001111', 'fx-qa-m11-gestora@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001112', 'fx-qa-m11-custodio@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001113', 'fx-qa-m11-lider@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001114', 'fx-qa-m11-comite@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000001111', 'FX QA M11 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('cccccccc-0000-4000-8000-000000001111', 'FX_QA_M11_HI', 'FX QA M11 alto', 'cumulative_target', 'higher_is_better', 95, 90),
  ('cccccccc-0000-4000-8000-000000001112', 'FX_QA_M11_LO', 'FX QA M11 bajo', 'window_average', 'lower_is_better', 5, 10);
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('aaaaaaaa-0000-4000-8000-000000001111', 'kpi_manager', null, null),
  ('aaaaaaaa-0000-4000-8000-000000001112', 'custodian', null, 'cccccccc-0000-4000-8000-000000001111'),
  ('aaaaaaaa-0000-4000-8000-000000001113', 'unit_leader', 'bbbbbbbb-0000-4000-8000-000000001111', null),
  ('aaaaaaaa-0000-4000-8000-000000001114', 'committee', null, null);
insert into public.commitments (id, unit_id, indicator_id, period, green_override, yellow_override, package_total,
                                package_by_category, created_by) values
  ('dddddddd-0000-4000-8000-000000001111', 'bbbbbbbb-0000-4000-8000-000000001111', 'cccccccc-0000-4000-8000-000000001111',
   '2033-Q1', 97, 92, 300, '{"P0P1": 200, "P2P3": 100}', 'aaaaaaaa-0000-4000-8000-000000001112'),
  ('dddddddd-0000-4000-8000-000000001112', 'bbbbbbbb-0000-4000-8000-000000001111', 'cccccccc-0000-4000-8000-000000001112',
   '2033-Q1', null, null, 10, '{"P0P1": 5}', null);
insert into public.targets (id, unit_id, indicator_id, month, target_value) values
  ('eeeeeeee-0000-4000-8000-000000001111', 'bbbbbbbb-0000-4000-8000-000000001111', 'cccccccc-0000-4000-8000-000000001111', '2033-01', 50);

-- ---------------------------------------------------------------------------
-- Catálogo y verificación previa a producción
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_constraint
    where convalidated
      and conname in ('indicators_green_threshold_safe', 'indicators_yellow_threshold_safe',
                      'commitments_green_override_safe', 'commitments_yellow_override_safe',
                      'commitments_package_total_safe', 'commitments_package_by_category_safe',
                      'targets_target_value_safe')),
  7, 'las siete restricciones de tope existen y están validadas (no NOT VALID)');
select is_empty(
  $$ select id from public.indicators
      where not (abs(green_threshold) < 9007199254740992)
         or not (abs(yellow_threshold) < 9007199254740992) $$,
  'verificación previa: indicators dentro del tope');
select is_empty(
  $$ select id from public.commitments
      where not (abs(green_override) < 9007199254740992)
         or not (abs(yellow_override) < 9007199254740992)
         or not (abs(package_total) < 9007199254740992)
         or jsonb_path_exists(package_by_category,
              'strict $.* ? (@.type() != "number" || @.abs() >= 9007199254740992)') $$,
  'verificación previa: commitments dentro del tope');
select is_empty(
  $$ select id from public.targets where not (abs(target_value) < 9007199254740992) $$,
  'verificación previa: targets dentro del tope');

-- ---------------------------------------------------------------------------
-- indicators: escribe la gestora (RLS)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001111","role":"authenticated"}';
select throws_ok(
  $$ update public.indicators set green_threshold = 1e300 where id = 'cccccccc-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'gestora: UPDATE green_threshold 1e300 rechazado');
select throws_ok(
  $$ update public.indicators set yellow_threshold = '-1e400' where id = 'cccccccc-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_safe"',
  'gestora: UPDATE yellow_threshold -1e400 rechazado');
select throws_ok(
  $$ update public.indicators set yellow_threshold = '1e400' where id = 'cccccccc-0000-4000-8000-000000001112' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_safe"',
  'gestora: UPDATE yellow_threshold 1e400 rechazado (menos es mejor, coherente)');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_QA_M11_E1', 'x', 'window_average', 'lower_is_better', 1, '9.007199254740992e15') $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_safe"',
  'gestora: INSERT yellow_threshold 2^53 en notación exponencial rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_QA_M11_E2', 'x', 'window_average', 'higher_is_better', 0, -9007199254740992) $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_safe"',
  'gestora: INSERT yellow_threshold -2^53 rechazado');
select throws_ok(
  $$ update public.indicators set green_threshold = 'NaN', yellow_threshold = 'NaN'
      where id = 'cccccccc-0000-4000-8000-000000001111' $$,
  '23514', null, 'gestora: NaN en ambos umbrales sigue rechazado');
select lives_ok(
  $$ update public.indicators set green_threshold = 9007199254740991.5, yellow_threshold = -9007199254740991.5
      where id = 'cccccccc-0000-4000-8000-000000001111' $$,
  'gestora: umbrales en ±(2^53 - 0.5) aceptados (el tope es estricto en 2^53)');
select lives_ok(
  $$ update public.indicators set green_threshold = 95, yellow_threshold = 90
      where id = 'cccccccc-0000-4000-8000-000000001111' $$,
  'gestora: umbrales normales aceptados');

-- ---------------------------------------------------------------------------
-- targets: escribe la gestora
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.targets set target_value = 1e300 where id = 'eeeeeeee-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'gestora: UPDATE meta 1e300 rechazado');
select throws_ok(
  $$ update public.targets set target_value = 9007199254740992 where id = 'eeeeeeee-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'gestora: UPDATE meta 2^53 rechazado');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001111', 'cccccccc-0000-4000-8000-000000001111', '2033-02', '1e400') $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'gestora: INSERT meta 1e400 rechazado');
select lives_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001111', 'cccccccc-0000-4000-8000-000000001111', '2033-03', 9007199254740991) $$,
  'gestora: INSERT meta 2^53 - 1 aceptado');

-- ---------------------------------------------------------------------------
-- commitments: escribe el custodio de su indicador
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001112","role":"authenticated"}';
select throws_ok(
  $$ update public.commitments set green_override = 1e300 where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_safe"',
  'custodio: UPDATE green_override 1e300 rechazado');
select throws_ok(
  $$ update public.commitments set yellow_override = '1e400' where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_yellow_override_safe"',
  'custodio: UPDATE yellow_override 1e400 rechazado');
select throws_ok(
  $$ update public.commitments set package_total = 1e300 where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_total_safe"',
  'custodio: UPDATE package_total 1e300 rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000001111', 'cccccccc-0000-4000-8000-000000001111', '2033-02',
             -9007199254740992, 5, 'aaaaaaaa-0000-4000-8000-000000001112') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_safe"',
  'custodio: INSERT green_override -2^53 rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_total, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000001111', 'cccccccc-0000-4000-8000-000000001111', '2033-02',
             '1e400', 'aaaaaaaa-0000-4000-8000-000000001112') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_total_safe"',
  'custodio: INSERT package_total 1e400 rechazado');

-- package_by_category: por clave, por la vía real (custodio).
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1e300, "P2P3": 100}'
      where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: package_by_category P0P1 1e300 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 200, "P2P3": -1e400}'
      where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: package_by_category P2P3 -1e400 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1, "P2P3": 2, "OTRA": 1e400}'
      where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: package_by_category con 1e400 en la tercera clave rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9.007199254740992e15}'
      where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: package_by_category 2^53 en notación exponencial rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": -9007199254740992}'
      where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: package_by_category -2^53 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": "200"}'
      where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: package_by_category con número como texto rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_by_category, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000001111', 'cccccccc-0000-4000-8000-000000001111', '2033-Q2',
             '{"P0P1": 100, "P2P3": 1e400}', 'aaaaaaaa-0000-4000-8000-000000001112') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: INSERT package_by_category con P2P3 1e400 rechazado');
-- No objeto: lo frena el CHECK previo de tipo con 23514, no un error de jsonpath en modo strict.
select throws_ok(
  $$ update public.commitments set package_by_category = '[1e400]'
      where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  '23514', null, 'custodio: package_by_category arreglo en la raíz rechazado con 23514');
select throws_ok(
  $$ update public.commitments set package_by_category = '1e400'
      where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  '23514', null, 'custodio: package_by_category escalar 1e400 en la raíz rechazado con 23514');
select lives_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9007199254740991.5, "P2P3": -9007199254740991, "X": 0.25}'
      where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  'custodio: package_by_category con valores bajo el tope (decimales, negativos) aceptado');
select lives_ok(
  $$ update public.commitments set green_override = 9007199254740991, yellow_override = -9007199254740991,
            package_total = 9007199254740991.5, package_by_category = '{"P0P1": 200, "P2P3": 100}'
      where id = 'dddddddd-0000-4000-8000-000000001111' $$,
  'custodio: overrides y paquete bajo el tope aceptados');

-- ---------------------------------------------------------------------------
-- Roles que no escriben: RLS sigue mandando (con valor válido)
-- ---------------------------------------------------------------------------
select is_empty(
  $$ update public.indicators set green_threshold = 1 where id = 'cccccccc-0000-4000-8000-000000001111' returning id $$,
  'custodio: no actualiza indicators (RLS)');
select is_empty(
  $$ update public.commitments set package_by_category = '{"P0P1": 1}'
      where indicator_id = 'cccccccc-0000-4000-8000-000000001112' returning id $$,
  'custodio: no actualiza commitments de un indicador ajeno (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001113","role":"authenticated"}';
select is_empty(
  $$ update public.commitments set package_by_category = '{"P0P1": 1}'
      where id = 'dddddddd-0000-4000-8000-000000001111' returning id $$,
  'líder: no actualiza package_by_category (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001114","role":"authenticated"}';
select is_empty(
  $$ update public.commitments set package_total = 1 where id = 'dddddddd-0000-4000-8000-000000001111' returning id $$,
  'comité: no actualiza commitments (RLS)');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001111', 'cccccccc-0000-4000-8000-000000001111', '2033-04', 1) $$,
  '42501', null, 'comité: no inserta targets (RLS)');
reset role;

-- Estado final: solo quedaron los valores válidos de los roles autorizados.
select is((select green_threshold from public.indicators where id = 'cccccccc-0000-4000-8000-000000001111'), 95::numeric,
  'indicators: queda el último umbral válido de la gestora');
select is((select package_by_category from public.commitments where id = 'dddddddd-0000-4000-8000-000000001111'),
  '{"P0P1": 200, "P2P3": 100}'::jsonb, 'commitments: queda el último package_by_category válido del custodio');
select is((select target_value from public.targets where id = 'eeeeeeee-0000-4000-8000-000000001111'), 50::numeric,
  'targets: la meta no cambió con los valores rechazados');
select is((select package_by_category from public.commitments where id = 'dddddddd-0000-4000-8000-000000001112'),
  '{"P0P1": 5}'::jsonb, 'commitments: el compromiso del indicador ajeno no cambió');

select * from finish();
rollback;
