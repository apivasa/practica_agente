-- QA M-10: casos que no cubren las pruebas del desarrollador (100).
-- Trazas:
--  - plan-maestro M-10: "pgTAP con 'NaN' e 'Infinity' por columna" -> también por la vía real
--    de escritura (rol authenticated con RLS: gestora en indicators y targets, custodio en
--    commitments), por UPDATE en cada columna y con las grafías alternativas que PostgreSQL
--    acepta para numeric ('nan', 'inf', '+inf', 'infinity').
--  - plan-maestro M-10 / H-M09-01: "valores finitos" -> los finitos grandes, el cero y los
--    negativos que ya permitía el modelo siguen aceptados (la migración no recorta el dominio).
--  - plan-maestro M-10: "verificación previa a producción" -> las restricciones quedan
--    validadas (no NOT VALID) y las consultas de verificación del archivo devuelven 0 filas.
--  - CLAUDE.md 4: prueba por rol -> un rol que no escribe la tabla no la escribe ni con valor
--    finito (el CHECK no reemplaza ni rompe RLS).
begin;
select plan(32);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000001011', 'fx-qa-m10-gestora@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001012', 'fx-qa-m10-custodio@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001013', 'fx-qa-m10-lider@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000001011', 'FX QA M10 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('cccccccc-0000-4000-8000-000000001011', 'FX_QA_M10_HI', 'FX QA M10 alto', 'window_average', 'higher_is_better', 95, 90),
  ('cccccccc-0000-4000-8000-000000001012', 'FX_QA_M10_LO', 'FX QA M10 bajo', 'window_average', 'lower_is_better', 5, 10);
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('aaaaaaaa-0000-4000-8000-000000001011', 'kpi_manager', null, null),
  ('aaaaaaaa-0000-4000-8000-000000001012', 'custodian', null, 'cccccccc-0000-4000-8000-000000001011'),
  ('aaaaaaaa-0000-4000-8000-000000001013', 'unit_leader', 'bbbbbbbb-0000-4000-8000-000000001011', null);
insert into public.commitments (id, unit_id, indicator_id, period, green_override, yellow_override, package_total, created_by) values
  ('dddddddd-0000-4000-8000-000000001011', 'bbbbbbbb-0000-4000-8000-000000001011', 'cccccccc-0000-4000-8000-000000001011',
   '2032-01', 97, 92, 100, 'aaaaaaaa-0000-4000-8000-000000001012');
insert into public.targets (id, unit_id, indicator_id, month, target_value) values
  ('eeeeeeee-0000-4000-8000-000000001011', 'bbbbbbbb-0000-4000-8000-000000001011', 'cccccccc-0000-4000-8000-000000001011', '2032-01', 50);

-- ---------------------------------------------------------------------------
-- Catálogo: restricciones presentes y validadas (verificación previa a producción)
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_constraint
    where convalidated
      and conname in ('indicators_green_threshold_finite', 'indicators_yellow_threshold_finite',
                      'commitments_green_override_finite', 'commitments_yellow_override_finite',
                      'commitments_package_total_finite', 'targets_target_value_finite')),
  6, 'las seis restricciones de valor finito existen y están validadas (no NOT VALID)');

-- Consultas de verificación del final de la migración: sobre la BD con semilla y fixtures, 0 filas.
select is_empty(
  $$ select id from public.indicators
      where green_threshold in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
         or yellow_threshold in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) $$,
  'verificación previa: indicators sin umbrales no finitos');
select is_empty(
  $$ select id from public.commitments
      where green_override in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
         or yellow_override in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
         or package_total in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) $$,
  'verificación previa: commitments sin valores no finitos');
select is_empty(
  $$ select id from public.targets
      where target_value in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) $$,
  'verificación previa: targets sin valores no finitos');

-- ---------------------------------------------------------------------------
-- indicators: escribe la gestora (RLS)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001011","role":"authenticated"}';

-- NaN en ambos umbrales: 'NaN' >= 'NaN' es verdadero, así que la coherencia no lo frena;
-- solo lo frena el CHECK finito.
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_QA_M10_N2', 'x', 'window_average', 'higher_is_better', 'NaN', 'NaN') $$,
  '23514', null, 'gestora: INSERT con ambos umbrales NaN rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('FX_QA_M10_I2', 'x', 'window_average', 'higher_is_better', 'inf', '+inf') $$,
  '23514', null, 'gestora: INSERT con umbrales inf / +inf rechazado');
select throws_ok(
  $$ update public.indicators set green_threshold = 'infinity' where id = 'cccccccc-0000-4000-8000-000000001011' $$,
  '23514', null, 'gestora: UPDATE green_threshold a infinity rechazado (más es mejor, coherente)');
select throws_ok(
  $$ update public.indicators set yellow_threshold = '-Infinity' where id = 'cccccccc-0000-4000-8000-000000001011' $$,
  '23514', null, 'gestora: UPDATE yellow_threshold a -Infinity rechazado (más es mejor, coherente)');
select throws_ok(
  $$ update public.indicators set yellow_threshold = 'Infinity' where id = 'cccccccc-0000-4000-8000-000000001012' $$,
  '23514', null, 'gestora: UPDATE yellow_threshold a Infinity rechazado (menos es mejor, coherente)');
select throws_ok(
  $$ update public.indicators set green_threshold = 'nan' where id = 'cccccccc-0000-4000-8000-000000001011' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_finite"',
  'gestora: UPDATE green_threshold a nan (minúsculas) rechazado por el CHECK finito (NaN >= amarillo es verdadero)');
select lives_ok(
  $$ update public.indicators set green_threshold = 1e300, yellow_threshold = -1e300
      where id = 'cccccccc-0000-4000-8000-000000001011' $$,
  'gestora: umbrales finitos extremos (1e300 / -1e300) aceptados');
select lives_ok(
  $$ update public.indicators set green_threshold = 0, yellow_threshold = 0
      where id = 'cccccccc-0000-4000-8000-000000001012' $$,
  'gestora: umbrales en cero aceptados');

-- ---------------------------------------------------------------------------
-- commitments: escribe el custodio de su indicador (RLS)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001012","role":"authenticated"}';
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000001011', 'cccccccc-0000-4000-8000-000000001011', '2032-02', 'NaN', 'NaN',
             'aaaaaaaa-0000-4000-8000-000000001012') $$,
  '23514', null, 'custodio: INSERT con pareja de overrides NaN rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_total, created_by)
     values ('bbbbbbbb-0000-4000-8000-000000001011', 'cccccccc-0000-4000-8000-000000001011', '2032-02', 'inf',
             'aaaaaaaa-0000-4000-8000-000000001012') $$,
  '23514', null, 'custodio: INSERT con package_total inf rechazado');
select throws_ok(
  $$ update public.commitments set green_override = 'Infinity' where id = 'dddddddd-0000-4000-8000-000000001011' $$,
  '23514', null, 'custodio: UPDATE green_override a Infinity rechazado');
select throws_ok(
  $$ update public.commitments set yellow_override = '-Infinity' where id = 'dddddddd-0000-4000-8000-000000001011' $$,
  '23514', null, 'custodio: UPDATE yellow_override a -Infinity rechazado');
select throws_ok(
  $$ update public.commitments set yellow_override = 'NaN' where id = 'dddddddd-0000-4000-8000-000000001011' $$,
  '23514', null, 'custodio: UPDATE yellow_override a NaN rechazado');
select throws_ok(
  $$ update public.commitments set package_total = 'NaN' where id = 'dddddddd-0000-4000-8000-000000001011' $$,
  '23514', null, 'custodio: UPDATE package_total a NaN rechazado (NaN >= 0 es verdadero en PostgreSQL)');
select throws_ok(
  $$ update public.commitments set package_total = 'Infinity' where id = 'dddddddd-0000-4000-8000-000000001011' $$,
  '23514', null, 'custodio: UPDATE package_total a Infinity rechazado');
select lives_ok(
  $$ update public.commitments set green_override = -5, yellow_override = -10, package_total = 0
      where id = 'dddddddd-0000-4000-8000-000000001011' $$,
  'custodio: overrides negativos finitos y paquete 0 siguen aceptados');
select lives_ok(
  $$ update public.commitments set green_override = null, yellow_override = null, package_total = null
      where id = 'dddddddd-0000-4000-8000-000000001011' $$,
  'custodio: limpiar overrides y paquete a NULL sigue aceptado');

-- ---------------------------------------------------------------------------
-- targets: escribe la gestora (UPDATE solo de target_value desde M-09)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001011","role":"authenticated"}';
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001011', 'cccccccc-0000-4000-8000-000000001012', '2032-01', '+inf') $$,
  '23514', null, 'gestora: INSERT de meta +inf rechazado');
select throws_ok(
  $$ update public.targets set target_value = 'Infinity' where id = 'eeeeeeee-0000-4000-8000-000000001011' $$,
  '23514', null, 'gestora: UPDATE de meta a Infinity rechazado');
select throws_ok(
  $$ update public.targets set target_value = 'nan' where id = 'eeeeeeee-0000-4000-8000-000000001011' $$,
  '23514', null, 'gestora: UPDATE de meta a nan rechazado');
select lives_ok(
  $$ update public.targets set target_value = 1e300 where id = 'eeeeeeee-0000-4000-8000-000000001011' $$,
  'gestora: meta finita grande aceptada');
select lives_ok(
  $$ update public.targets set target_value = 0 where id = 'eeeeeeee-0000-4000-8000-000000001011' $$,
  'gestora: meta 0 aceptada');

-- ---------------------------------------------------------------------------
-- Roles que no escriben: RLS sigue mandando (ni con valor finito)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001013","role":"authenticated"}';
select is_empty(
  $$ update public.commitments set package_total = 1 where id = 'dddddddd-0000-4000-8000-000000001011' returning id $$,
  'líder: no actualiza commitments (RLS)');
select is_empty(
  $$ update public.targets set target_value = 1 where id = 'eeeeeeee-0000-4000-8000-000000001011' returning id $$,
  'líder: no actualiza targets (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001012","role":"authenticated"}';
select is_empty(
  $$ update public.indicators set green_threshold = 1 where id = 'cccccccc-0000-4000-8000-000000001011' returning id $$,
  'custodio: no actualiza indicators (RLS)');
reset role;

-- Estado final: solo quedaron los valores finitos que escribieron los roles autorizados.
select is((select green_threshold from public.indicators where id = 'cccccccc-0000-4000-8000-000000001011'), 1e300::numeric,
  'indicators: queda el último umbral finito de la gestora');
select is((select package_total from public.commitments where id = 'dddddddd-0000-4000-8000-000000001011'), null::numeric,
  'commitments: queda el último valor del custodio (NULL)');
select is((select target_value from public.targets where id = 'eeeeeeee-0000-4000-8000-000000001011'), 0::numeric,
  'targets: queda la última meta finita de la gestora');

select * from finish();
rollback;
