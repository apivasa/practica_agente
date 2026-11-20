-- QA M-14 (H-ARQ-M13-01): casos que no cubren las pruebas del desarrollador (114).
-- Trazas:
--  - plan-maestro M-14 / migración: "pasa en la BD" equivale a "pasa en el motor" -> el borde
--    es exactamente 2^53 - 0,5 (exclusivo): 2^53 - 0,5 - 1e-10 entra y 2^53 - 0,5 + 1e-10 no;
--    también escrito en notación exponencial, por columna y dentro del JSONB.
--  - migración: "Se reemplazan los CHECK con el MISMO nombre" -> un solo CHECK por nombre (sin
--    duplicados ni restos del tope 2^53) y ningún otro CHECK con el literal viejo.
--  - migración: "La semilla cumple" -> la semilla está cargada y volver a aplicar las sentencias
--    de la migración sobre ella no falla (el ADD valida las filas existentes).
--  - migración: "el ADD ... falla (sin aplicar nada) si alguna queda fuera" -> con una fila en
--    2^53 - 0,5 el ALTER falla con 23514 y el CHECK anterior sigue en su sitio.
--  - migración: "Verificación previa" -> las consultas comentadas devuelven 0 filas sobre la
--    semilla y detectan una fila en 2^53 - 0,5 (no la de 2^53 - 0,6).
--  - migración: "Trigger de M-09 ... coherente" -> en meta acumulada con categorías 2^53 - 0,6 no
--    entra (no es entero) y 2^53 - 1 sí.
--  - CLAUDE.md 4: prueba por rol -> líder, comité y anónimo siguen sin escribir aunque el valor
--    esté dentro del tope nuevo.
begin;
select plan(30);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000001501', 'fx-qa-m14-gestora@example.test',  'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001502', 'fx-qa-m14-custodio@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001503', 'fx-qa-m14-lider@example.test',    'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000001504', 'fx-qa-m14-comite@example.test',   'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000001501', 'FX QA M14 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold,
                               thresholds_by_category) values
  ('cccccccc-0000-4000-8000-000000001501', 'FX_QA_M14_HI', 'FX QA M14 alto', 'window_average', 'higher_is_better', 95, 90, '{}'),
  ('cccccccc-0000-4000-8000-000000001502', 'FX_QA_M14_CAT', 'FX QA M14 categorías', 'cumulative_target', 'higher_is_better', 96, 90,
   '{"P0P1": {"green": 96, "yellow": 90}}');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('aaaaaaaa-0000-4000-8000-000000001501', 'kpi_manager', null, null),
  ('aaaaaaaa-0000-4000-8000-000000001502', 'custodian',   null, 'cccccccc-0000-4000-8000-000000001502'),
  ('aaaaaaaa-0000-4000-8000-000000001503', 'unit_leader', 'bbbbbbbb-0000-4000-8000-000000001501', null),
  ('aaaaaaaa-0000-4000-8000-000000001504', 'committee',   null, null);
insert into public.commitments (id, unit_id, indicator_id, period, package_total, package_by_category) values
  ('dddddddd-0000-4000-8000-000000001501', 'bbbbbbbb-0000-4000-8000-000000001501', 'cccccccc-0000-4000-8000-000000001501',
   '2035-Q1', 300, '{"P0P1": 200, "P2P3": 100}');

-- ---------------------------------------------------------------------------
-- Catálogo: un CHECK por nombre, ninguno con el literal viejo
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_constraint
    where contype = 'c'
      and conname in ('indicators_green_threshold_safe', 'indicators_yellow_threshold_safe',
                      'indicators_thresholds_by_category_safe',
                      'commitments_green_override_safe', 'commitments_yellow_override_safe',
                      'commitments_package_total_safe', 'commitments_package_by_category_safe',
                      'targets_target_value_safe', 'measurements_value_safe')),
  9, 'los 9 CHECK _safe existen una sola vez (DROP + ADD con el mismo nombre, sin duplicados)');
select is_empty(
  $$ select conname from pg_constraint
      where contype = 'c' and connamespace = 'public'::regnamespace
        and pg_get_constraintdef(oid) like '%9007199254740992%' $$,
  'ningún CHECK de public conserva el tope viejo 9007199254740992');

-- ---------------------------------------------------------------------------
-- La migración aplica sobre la semilla
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) from public.indicators where code in ('VULN', 'AVAIL', 'MTTR')) = 3
  and (select count(*) from public.commitments where period = '2027-Q1') >= 3
  and (select count(*) from public.targets where month = '2027-01') >= 3
  and (select count(*) from public.measurements where measured_on between '2027-01-01' and '2027-03-31') > 0,
  'la semilla está cargada (indicadores, compromisos, metas y mediciones)');
select lives_ok(
  $$ alter table public.indicators
       drop constraint indicators_green_threshold_safe,
       add constraint indicators_green_threshold_safe check (abs(green_threshold) < 9007199254740991.5),
       drop constraint indicators_yellow_threshold_safe,
       add constraint indicators_yellow_threshold_safe check (abs(yellow_threshold) < 9007199254740991.5);
     alter table public.commitments
       drop constraint commitments_green_override_safe,
       add constraint commitments_green_override_safe
         check (green_override is null or abs(green_override) < 9007199254740991.5),
       drop constraint commitments_yellow_override_safe,
       add constraint commitments_yellow_override_safe
         check (yellow_override is null or abs(yellow_override) < 9007199254740991.5),
       drop constraint commitments_package_total_safe,
       add constraint commitments_package_total_safe
         check (package_total is null or abs(package_total) < 9007199254740991.5),
       drop constraint commitments_package_by_category_safe,
       add constraint commitments_package_by_category_safe
         check (package_by_category is null or not jsonb_path_exists(package_by_category,
           'strict $.* ? (@.type() != "number" || @.abs() >= 9007199254740991.5)'));
     alter table public.targets
       drop constraint targets_target_value_safe,
       add constraint targets_target_value_safe check (abs(target_value) < 9007199254740991.5);
     alter table public.measurements
       drop constraint measurements_value_safe,
       add constraint measurements_value_safe check (value is null or abs(value) < 9007199254740991.5) $$,
  'volver a aplicar los ALTER de la migración sobre la semilla (y estas fixtures) no falla');

-- Verificación previa (consultas comentadas de la migración, tal cual) sobre la semilla: 0 filas.
select is_empty(
  $$ select id, code, green_threshold, yellow_threshold, thresholds_by_category
       from public.indicators
      where not (abs(green_threshold) < 9007199254740991.5)
         or not (abs(yellow_threshold) < 9007199254740991.5)
         or jsonb_path_exists(thresholds_by_category,
              'strict $.* ? (@.type() == "object").* ? (@.type() != "number" || @.abs() >= 9007199254740991.5)') $$,
  'verificación previa: indicators, 0 filas');
select is_empty(
  $$ select id, green_override, yellow_override, package_total, package_by_category
       from public.commitments
      where not (abs(green_override) < 9007199254740991.5)
         or not (abs(yellow_override) < 9007199254740991.5)
         or not (abs(package_total) < 9007199254740991.5)
         or jsonb_path_exists(package_by_category,
              'strict $.* ? (@.type() != "number" || @.abs() >= 9007199254740991.5)') $$,
  'verificación previa: commitments, 0 filas');
select is_empty(
  $$ select id, target_value from public.targets where not (abs(target_value) < 9007199254740991.5) $$,
  'verificación previa: targets, 0 filas');
select is_empty(
  $$ select id, indicator_id, measured_on, value from public.measurements
      where not (abs(value) < 9007199254740991.5) $$,
  'verificación previa: measurements, 0 filas');

-- ---------------------------------------------------------------------------
-- Borde exacto (exclusivo) y notación exponencial
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.indicators set green_threshold = 9007199254740991.4999999999, yellow_threshold = 90
      where id = 'cccccccc-0000-4000-8000-000000001501' $$,
  'green_threshold: 2^53 - 0,5 - 1e-10 aceptado (JSON.parse: 2^53 - 1)');
select throws_ok(
  $$ update public.indicators set green_threshold = 9007199254740991.5000000001
      where id = 'cccccccc-0000-4000-8000-000000001501' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'green_threshold: 2^53 - 0,5 + 1e-10 rechazado (JSON.parse: 2^53)');
select throws_ok(
  $$ update public.indicators set yellow_threshold = '-9.0071992547409915e15'
      where id = 'cccccccc-0000-4000-8000-000000001501' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_safe"',
  'yellow_threshold: -(2^53 - 0,5) en notación exponencial rechazado');
select lives_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 9.007199254740991e15, "yellow": 9007199254740991.4999999999}}'
      where id = 'cccccccc-0000-4000-8000-000000001501' $$,
  'thresholds_by_category: 2^53 - 1 exponencial y 2^53 - 0,5 - 1e-10 aceptados');
select throws_ok(
  $$ update public.indicators set thresholds_by_category = '{"P0P1": {"green": 96, "yellow": 9.0071992547409915e15}}'
      where id = 'cccccccc-0000-4000-8000-000000001501' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_thresholds_by_category_safe"',
  'thresholds_by_category: 2^53 - 0,5 en notación exponencial rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9.0071992547409915e15}'
      where id = 'dddddddd-0000-4000-8000-000000001501' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'package_by_category: 2^53 - 0,5 en notación exponencial rechazado por el tope');
select throws_ok(
  $$ update public.commitments set green_override = -9007199254740991.5000000001, yellow_override = 1
      where id = 'dddddddd-0000-4000-8000-000000001501' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_safe"',
  'green_override: -(2^53 - 0,5 + 1e-10) rechazado');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001501', 'cccccccc-0000-4000-8000-000000001501', '2035-01', '9.0071992547409915e15') $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'target_value: 2^53 - 0,5 en notación exponencial rechazado');
select lives_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('bbbbbbbb-0000-4000-8000-000000001501', 'cccccccc-0000-4000-8000-000000001501', '2035-02', 9007199254740991.4999999999) $$,
  'target_value: 2^53 - 0,5 - 1e-10 aceptado');

-- ---------------------------------------------------------------------------
-- Trigger de M-09 (meta acumulada con categorías): sigue exigiendo entero
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000001501', 'cccccccc-0000-4000-8000-000000001502', '2035-01-05', 9007199254740991.4, 'P0P1', 'resolved') $$,
  '23514', null, 'meta acumulada con categorías: 2^53 - 0,6 rechazado (no entero, aunque pasa el tope)');
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000001501', 'cccccccc-0000-4000-8000-000000001502', '2035-01-05', 9007199254740991, 'P0P1', 'resolved') $$,
  'meta acumulada con categorías: 2^53 - 1 aceptado');

-- ---------------------------------------------------------------------------
-- RLS: el tope nuevo no abre escrituras a roles que no escriben
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001503","role":"authenticated"}';
select is_empty(
  $$ update public.indicators set green_threshold = 9007199254740991.4
      where id = 'cccccccc-0000-4000-8000-000000001501' returning id $$,
  'líder: no actualiza indicators con un valor dentro del tope (RLS)');
select is_empty(
  $$ update public.commitments set package_total = 9007199254740991.4
      where id = 'dddddddd-0000-4000-8000-000000001501' returning id $$,
  'líder: no actualiza commitments con un valor dentro del tope (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001504","role":"authenticated"}';
select is_empty(
  $$ update public.indicators set yellow_threshold = -9007199254740991.4
      where id = 'cccccccc-0000-4000-8000-000000001501' returning id $$,
  'comité: no actualiza indicators con un valor dentro del tope (RLS)');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000001501', 'cccccccc-0000-4000-8000-000000001501', '2035-01-06', 9007199254740991.4) $$,
  '42501', null, 'comité: no inserta mediciones aunque el valor esté dentro del tope (RLS)');
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000001501","role":"authenticated"}';
select lives_ok(
  $$ update public.indicators set green_threshold = 9007199254740991.4, yellow_threshold = -9007199254740991.4
      where id = 'cccccccc-0000-4000-8000-000000001501' $$,
  'gestora: ±(2^53 - 0,6) aceptado por la vía real (authenticated)');
reset role;
set local role anon;
select throws_ok(
  $$ update public.indicators set green_threshold = 1 where id = 'cccccccc-0000-4000-8000-000000001501' $$,
  '42501', null, 'anónimo: no actualiza indicators');
reset role;
select is((select green_threshold from public.indicators where id = 'cccccccc-0000-4000-8000-000000001501'),
  9007199254740991.4::numeric, 'indicators: queda el valor de la gestora, no el del líder ni el del comité');

-- ---------------------------------------------------------------------------
-- La verificación previa detecta 2^53 - 0,5 (y no 2^53 - 0,6); el ALTER falla y es atómico
-- ---------------------------------------------------------------------------
alter table public.measurements drop constraint measurements_value_safe;
alter table public.targets drop constraint targets_target_value_safe;
insert into public.measurements (unit_id, indicator_id, measured_on, value) values
  ('bbbbbbbb-0000-4000-8000-000000001501', 'cccccccc-0000-4000-8000-000000001501', '2035-02-01', 9007199254740991.5),
  ('bbbbbbbb-0000-4000-8000-000000001501', 'cccccccc-0000-4000-8000-000000001501', '2035-02-02', 9007199254740991.4);
insert into public.targets (unit_id, indicator_id, month, target_value) values
  ('bbbbbbbb-0000-4000-8000-000000001501', 'cccccccc-0000-4000-8000-000000001501', '2035-03', 9007199254740991.5);
select is(
  (select count(*)::int from public.measurements where not (abs(value) < 9007199254740991.5)),
  1, 'verificación previa: detecta la medición en 2^53 - 0,5 y no la de 2^53 - 0,6');
select is(
  (select count(*)::int from public.targets where not (abs(target_value) < 9007199254740991.5)),
  1, 'verificación previa: detecta la meta en 2^53 - 0,5');
-- Atomicidad: con el CHECK anterior (NOT VALID, para poder tener la fila mala) en su sitio, la
-- sentencia DROP + ADD de la migración falla y deja el CHECK anterior intacto.
alter table public.measurements
  add constraint measurements_value_safe check (value is null or abs(value) < 9007199254740992) not valid;
select throws_ok(
  $$ alter table public.measurements
       drop constraint measurements_value_safe,
       add constraint measurements_value_safe check (value is null or abs(value) < 9007199254740991.5) $$,
  '23514', null, 'el DROP + ADD de la migración falla si queda una fila en 2^53 - 0,5');
select ok(
  (select pg_get_constraintdef(oid) like '%9007199254740992%' and not convalidated
     from pg_constraint where conname = 'measurements_value_safe'),
  'tras el fallo sigue el CHECK anterior: no hubo instante sin restricción ni cambio a medias');

select * from finish();
rollback;
