-- M-09 (pruebas del desarrollador): H-M07-01 (authenticated solo actualiza target_value de
-- targets) y H-M08-01 (mediciones sin NaN/Infinity y, en VULN, enteros seguros <= 2^53 - 1).
begin;
select plan(24);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000901', 'fx-m09-gestora@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000902', 'fx-m09-custodio@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000000901', 'FX M09 Unidad 1'),
  ('bbbbbbbb-0000-4000-8000-000000000902', 'FX M09 Unidad 2');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold, thresholds_by_category) values
  ('cccccccc-0000-4000-8000-000000000901', 'FX_M09_VULN', 'FX M09 VULN', 'cumulative_target', 'higher_is_better', 96, 90,
   '{"P0P1": {"green": 96, "yellow": 90}, "P2P3": {"green": 85, "yellow": 75}}'),
  ('cccccccc-0000-4000-8000-000000000902', 'FX_M09_AVG', 'FX M09 promedio', 'window_average', 'higher_is_better', 99.9, 99.5, '{}');
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('aaaaaaaa-0000-4000-8000-000000000901', 'kpi_manager', null, null),
  ('aaaaaaaa-0000-4000-8000-000000000902', 'custodian', null, 'cccccccc-0000-4000-8000-000000000901'),
  ('aaaaaaaa-0000-4000-8000-000000000902', 'custodian', null, 'cccccccc-0000-4000-8000-000000000902');
insert into public.targets (id, unit_id, indicator_id, month, target_value) values
  ('dddddddd-0000-4000-8000-000000000901', 'bbbbbbbb-0000-4000-8000-000000000901', 'cccccccc-0000-4000-8000-000000000901', '2031-01', 10);

-- H-M07-01: privilegios de columna en targets
select ok(has_column_privilege('authenticated', 'public.targets', 'target_value', 'UPDATE'),
  'authenticated: UPDATE de target_value');
select ok(not has_table_privilege('authenticated', 'public.targets', 'UPDATE'),
  'authenticated: sin UPDATE de tabla en targets');
select ok(not has_column_privilege('authenticated', 'public.targets', 'unit_id', 'UPDATE'),
  'authenticated: sin UPDATE de unit_id');
select ok(not has_column_privilege('authenticated', 'public.targets', 'indicator_id', 'UPDATE'),
  'authenticated: sin UPDATE de indicator_id');
select ok(not has_column_privilege('authenticated', 'public.targets', 'month', 'UPDATE'),
  'authenticated: sin UPDATE de month');
select ok(not has_column_privilege('authenticated', 'public.targets', 'id', 'UPDATE'),
  'authenticated: sin UPDATE de id');
select ok(not has_column_privilege('authenticated', 'public.targets', 'created_at', 'UPDATE'),
  'authenticated: sin UPDATE de created_at');
select ok(not has_column_privilege('anon', 'public.targets', 'target_value', 'UPDATE'),
  'anon: sin UPDATE de target_value');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000901","role":"authenticated"}';
select results_eq(
  $$ update public.targets set target_value = 12 where id = 'dddddddd-0000-4000-8000-000000000901' returning target_value $$,
  $$ values (12::numeric) $$,
  'gestora: edita target_value (flujo de target-admin.js)');
select throws_ok(
  $$ update public.targets set unit_id = 'bbbbbbbb-0000-4000-8000-000000000902' where id = 'dddddddd-0000-4000-8000-000000000901' $$,
  '42501', null, 'gestora: no mueve la meta a otra unidad');
select throws_ok(
  $$ update public.targets set month = '2031-02' where id = 'dddddddd-0000-4000-8000-000000000901' $$,
  '42501', null, 'gestora: no mueve la meta a otro mes');
select throws_ok(
  $$ update public.targets set indicator_id = 'cccccccc-0000-4000-8000-000000000902' where id = 'dddddddd-0000-4000-8000-000000000901' $$,
  '42501', null, 'gestora: no mueve la meta a otro indicador');
reset role;
select is((select unit_id::text || '|' || month || '|' || target_value::text from public.targets
            where id = 'dddddddd-0000-4000-8000-000000000901'),
  'bbbbbbbb-0000-4000-8000-000000000901|2031-01|12', 'la meta conserva unidad y mes');

-- H-M08-01: CHECK de la tabla (todos los indicadores, también el backend que salta RLS)
select ok(exists (select 1 from pg_constraint where conname = 'measurements_value_finite'
                    and conrelid = 'public.measurements'::regclass),
  'measurements tiene el CHECK measurements_value_finite');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000000901', 'cccccccc-0000-4000-8000-000000000902', '2031-01-10', 'NaN') $$,
  '23514', null, 'backend: NaN se rechaza en un promedio');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000000901', 'cccccccc-0000-4000-8000-000000000902', '2031-01-10', 'Infinity') $$,
  '23514', null, 'backend: Infinity se rechaza en un promedio');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000000901', 'cccccccc-0000-4000-8000-000000000902', '2031-01-10', '-Infinity') $$,
  '23514', null, 'backend: -Infinity se rechaza en un promedio');

-- Custodio por la API (PostgREST pasa "NaN" e "Infinity" como cadena)
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000902","role":"authenticated"}';
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000901', 'cccccccc-0000-4000-8000-000000000901', '2031-01-10', 'NaN', 'P0P1', 'resolved') $$,
  '23514', null, 'custodio: NaN en VULN se rechaza');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000901', 'cccccccc-0000-4000-8000-000000000901', '2031-01-10', 'Infinity', 'P0P1', 'detected') $$,
  '23514', null, 'custodio: Infinity en VULN se rechaza');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000901', 'cccccccc-0000-4000-8000-000000000901', '2031-01-10', 9007199254740992, 'P2P3', 'resolved') $$,
  '23514', null, 'custodio: 2^53 en VULN se rechaza');
select throws_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000901', 'cccccccc-0000-4000-8000-000000000901', '2031-01-10', 1e30, 'P2P3', 'resolved') $$,
  '23514', null, 'custodio: 1e30 en VULN se rechaza');
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value, category, kind)
     values ('bbbbbbbb-0000-4000-8000-000000000901', 'cccccccc-0000-4000-8000-000000000901', '2031-01-11', 9007199254740991, 'P2P3', 'resolved') $$,
  'custodio: 2^53 - 1 (Number.MAX_SAFE_INTEGER) en VULN se acepta');
select lives_ok(
  $$ insert into public.measurements (unit_id, indicator_id, measured_on, value)
     values ('bbbbbbbb-0000-4000-8000-000000000901', 'cccccccc-0000-4000-8000-000000000902', '2031-01-11', 99.95) $$,
  'custodio: valor finito decimal en un promedio se acepta');
reset role;
select is((select count(*)::int from public.measurements
            where indicator_id in ('cccccccc-0000-4000-8000-000000000901', 'cccccccc-0000-4000-8000-000000000902')
              and measured_on = '2031-01-10'), 0,
  'ninguna fila rechazada quedó guardada');

select * from finish();
rollback;
