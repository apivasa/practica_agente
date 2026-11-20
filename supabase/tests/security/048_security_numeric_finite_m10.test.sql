-- Seguridad (M-10), categorías 1 y 3: cierre de H-M09-01 verificado con el rol que escribe
-- cada columna (no como superusuario) y con las variantes de escritura que numeric_in acepta
-- ('nan', '  NaN ', 'inf', '+inf', '-inf', 'INFINITY'). Además, barrido del catálogo: ninguna
-- columna numeric/real/double de public que authenticated pueda insertar o actualizar queda
-- sin un CHECK que excluya NaN (regresión para columnas nuevas).
begin;
select plan(19);

-- Catálogo ------------------------------------------------------------------
select is_empty(
  $$ select c.table_name || '.' || c.column_name
       from information_schema.columns c
      where c.table_schema = 'public'
        and c.data_type in ('numeric', 'real', 'double precision')
        and exists (select 1 from information_schema.tables t
                     where t.table_schema = 'public' and t.table_name = c.table_name and t.table_type = 'BASE TABLE')
        and (has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'INSERT')
             or has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'UPDATE')
             or has_column_privilege('anon', format('public.%I', c.table_name), c.column_name, 'INSERT')
             or has_column_privilege('anon', format('public.%I', c.table_name), c.column_name, 'UPDATE'))
        and not exists (
          select 1 from pg_constraint k
            join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
           where k.conrelid = format('public.%I', c.table_name)::regclass
             and k.contype = 'c' and k.convalidated
             and a.attname = c.column_name
             and pg_get_constraintdef(k.oid) ilike '%NaN%'
             and pg_get_constraintdef(k.oid) ilike '%Infinity%') $$,
  'toda columna numeric escribible por la API tiene un CHECK validado que excluye NaN e Infinity');

select is(
  (select count(*)::int from pg_constraint
    where contype = 'c' and convalidated and conname in (
      'indicators_green_threshold_finite', 'indicators_yellow_threshold_finite',
      'commitments_green_override_finite', 'commitments_yellow_override_finite',
      'commitments_package_total_finite', 'targets_target_value_finite')),
  6, 'los 6 CHECK de M-10 existen y están validados (no NOT VALID)');

select ok(
  not has_table_privilege('authenticated', 'public.evaluations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.evaluations', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.evaluations', 'value', 'UPDATE')
  and not has_table_privilege('anon', 'public.evaluations', 'UPDATE'),
  'evaluations.value (sin CHECK) no es escribible por la API');

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('5ec00000-0000-4000-8000-000000000a01', 'sec-m10-gestora@example.test',  'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000a02', 'sec-m10-custodio@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('5ec10000-0000-4000-8000-000000000a01', 'SEC M10 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('5ec20000-0000-4000-8000-000000000a01', 'SEC_M10_AVG', 'SEC M10 promedio', 'window_average', 'higher_is_better', 95, 90),
  ('5ec20000-0000-4000-8000-000000000a02', 'SEC_M10_CUM', 'SEC M10 acumulado', 'cumulative_target', 'higher_is_better', 100, 80);
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec00000-0000-4000-8000-000000000a01', 'kpi_manager', null, null),
  ('5ec00000-0000-4000-8000-000000000a02', 'custodian',   null, '5ec20000-0000-4000-8000-000000000a01'),
  ('5ec00000-0000-4000-8000-000000000a02', 'custodian',   null, '5ec20000-0000-4000-8000-000000000a02');
insert into public.targets (id, unit_id, indicator_id, month, target_value) values
  ('5ec30000-0000-4000-8000-000000000a01', '5ec10000-0000-4000-8000-000000000a01', '5ec20000-0000-4000-8000-000000000a02', '2031-01', 10);
insert into public.commitments (id, unit_id, indicator_id, period, package_total, created_by) values
  ('5ec50000-0000-4000-8000-000000000a01', '5ec10000-0000-4000-8000-000000000a01', '5ec20000-0000-4000-8000-000000000a02', '2031-Q1', 30,
   '5ec00000-0000-4000-8000-000000000a02');
insert into public.commitments (id, unit_id, indicator_id, period, green_override, yellow_override, created_by) values
  ('5ec50000-0000-4000-8000-000000000a02', '5ec10000-0000-4000-8000-000000000a01', '5ec20000-0000-4000-8000-000000000a01', '2031-01', 97, 92,
   '5ec00000-0000-4000-8000-000000000a02');

set local role authenticated;

-- Gestora: umbrales y metas ---------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000a01","role":"authenticated"}';
select throws_ok(
  $$ update public.indicators set green_threshold = '  nan ' where id = '5ec20000-0000-4000-8000-000000000a01' $$,
  '23514', null, 'gestora: green_threshold = "  nan " rechazado');
select throws_ok(
  $$ update public.indicators set green_threshold = '+inf' where id = '5ec20000-0000-4000-8000-000000000a01' $$,
  '23514', null, 'gestora: green_threshold = "+inf" rechazado');
select throws_ok(
  $$ update public.indicators set yellow_threshold = '-inf' where id = '5ec20000-0000-4000-8000-000000000a01' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_finite"',
  'gestora: yellow_threshold = "-inf" rechazado por el CHECK finito');
select throws_ok(
  $$ update public.indicators set green_threshold = 'INFINITY', yellow_threshold = 'NaN'
      where id = '5ec20000-0000-4000-8000-000000000a01' $$,
  '23514', null, 'gestora: ambos umbrales no finitos en el mismo UPDATE rechazado');
select throws_ok(
  $$ insert into public.indicators (code, name, measurement_type, direction, green_threshold, yellow_threshold)
     values ('SEC_M10_NEW', 'x', 'window_average', 'lower_is_better', 'nan', 'inf') $$,
  '23514', null, 'gestora: INSERT de indicador con umbrales no finitos rechazado');
select throws_ok(
  $$ update public.targets set target_value = 'nan' where id = '5ec30000-0000-4000-8000-000000000a01' $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_finite"',
  'gestora: target_value = "nan" rechazado por el CHECK finito');
select throws_ok(
  $$ update public.targets set target_value = ' Infinity ' where id = '5ec30000-0000-4000-8000-000000000a01' $$,
  '23514', null, 'gestora: target_value = " Infinity " rechazado');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-000000000a01', '5ec20000-0000-4000-8000-000000000a02', '2031-01', 'NaN')
     on conflict (unit_id, indicator_id, month) do update set target_value = excluded.target_value $$,
  '23514', null, 'gestora: upsert de target_value a NaN rechazado');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-000000000a01', '5ec20000-0000-4000-8000-000000000a02', '2031-02', 'inf') $$,
  '23514', null, 'gestora: INSERT de meta "inf" rechazado');

-- Custodio: compromisos -------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000a02","role":"authenticated"}';
select throws_ok(
  $$ update public.commitments set package_total = 'NAN' where id = '5ec50000-0000-4000-8000-000000000a01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_total_finite"',
  'custodio: package_total = "NAN" rechazado por el CHECK finito');
select throws_ok(
  $$ update public.commitments set package_total = 'infinity' where id = '5ec50000-0000-4000-8000-000000000a01' $$,
  '23514', null, 'custodio: package_total = "infinity" rechazado');
select throws_ok(
  $$ update public.commitments set green_override = ' nan ' where id = '5ec50000-0000-4000-8000-000000000a02' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_finite"',
  'custodio: green_override = " nan " rechazado por el CHECK finito');
select throws_ok(
  $$ update public.commitments set yellow_override = '-Infinity' where id = '5ec50000-0000-4000-8000-000000000a02' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_yellow_override_finite"',
  'custodio: yellow_override = "-Infinity" rechazado por el CHECK finito');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, green_override, yellow_override, created_by)
     values ('5ec10000-0000-4000-8000-000000000a01', '5ec20000-0000-4000-8000-000000000a01', '2031-02', 'inf', 'nan',
             '5ec00000-0000-4000-8000-000000000a02') $$,
  '23514', null, 'custodio: INSERT de compromiso con overrides no finitos rechazado');
select lives_ok(
  $$ update public.commitments set green_override = 98.5, yellow_override = 93 where id = '5ec50000-0000-4000-8000-000000000a02' $$,
  'custodio: overrides finitos pasan (control positivo: la fila es alcanzable por RLS)');

reset role;
select is(
  (select green_threshold::text || '|' || yellow_threshold::text from public.indicators where id = '5ec20000-0000-4000-8000-000000000a01')
  || '#' || (select target_value::text from public.targets where id = '5ec30000-0000-4000-8000-000000000a01')
  || '#' || (select package_total::text from public.commitments where id = '5ec50000-0000-4000-8000-000000000a01'),
  '95|90#10#30', 'umbrales, meta y paquete conservan su valor tras los intentos rechazados');

select * from finish();
rollback;
