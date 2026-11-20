-- Seguridad (M-11), categorías 1 y 3: verificación activa del cierre de H-M10-01 por vías
-- que no cubren las pruebas del desarrollador (110):
--  * Catálogo: los 7 CHECK de M-11 existen, están validados (no NOT VALID) y no dependen de
--    funciones propias (no hay función nueva expuesta por PostgREST); barrido de regresión:
--    toda columna numeric escribible por la API tiene un CHECK de tope 2^53, salvo el residual
--    documentado (measurements.value, H-M11-02); las columnas JSONB escribibles por la API
--    son exactamente las dos revisadas.
--  * Con el rol que escribe cada columna (gestora, custodio) bajo RLS: notación exponencial
--    equivalente a 2^53, negativos en el límite, UPDATE calculado (x * 1e20), upsert,
--    UPDATE parcial del JSONB con `||` y jsonb_set, claves raras (__proto__), cadenas
--    numéricas, claves duplicadas y JSONB que no es objeto.
begin;
select plan(30);

-- Catálogo --------------------------------------------------------------------
select is(
  (select count(*)::int from pg_constraint
    where contype = 'c' and convalidated and conname in (
      'indicators_green_threshold_safe', 'indicators_yellow_threshold_safe',
      'commitments_green_override_safe', 'commitments_yellow_override_safe',
      'commitments_package_total_safe', 'commitments_package_by_category_safe',
      'targets_target_value_safe')),
  7, 'los 7 CHECK de M-11 existen y están validados (no NOT VALID)');

select is_empty(
  $$ select k.conname from pg_constraint k
       join pg_depend d on d.classid = 'pg_constraint'::regclass and d.objid = k.oid
                       and d.refclassid = 'pg_proc'::regclass
       join pg_proc p on p.oid = d.refobjid
       join pg_namespace n on n.oid = p.pronamespace
      where k.conname like '%\_safe' and n.nspname not in ('pg_catalog', 'information_schema') $$,
  'los CHECK de M-11 no dependen de funciones propias (sin superficie RPC nueva)');

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
        -- Residual documentado H-M11-02 (docs/seguridad/hallazgos.md): el tope de
        -- measurements.value vive en el trigger y solo para indicadores con categorías.
        and (c.table_name, c.column_name) <> ('measurements', 'value')
        and not exists (
          select 1 from pg_constraint k
            join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
           where k.conrelid = format('public.%I', c.table_name)::regclass
             and k.contype = 'c' and k.convalidated
             and a.attname = c.column_name
             and pg_get_constraintdef(k.oid) like '%9007199254740992%') $$,
  'toda columna numeric escribible por la API tiene un CHECK validado con tope 2^53');

select is(
  (select string_agg(c.table_name || '.' || c.column_name, ',' order by c.table_name, c.column_name)
     from information_schema.columns c
    where c.table_schema = 'public' and c.data_type in ('json', 'jsonb')
      and (has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'INSERT')
           or has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'UPDATE')
           or has_column_privilege('anon', format('public.%I', c.table_name), c.column_name, 'INSERT')
           or has_column_privilege('anon', format('public.%I', c.table_name), c.column_name, 'UPDATE'))),
  'commitments.package_by_category,indicators.thresholds_by_category',
  'las únicas columnas JSON escribibles por la API son las dos revisadas (una nueva exige revisión)');

-- Fixtures --------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('5ec00000-0000-4000-8000-000000000b01', 'sec-m11-gestora@example.test',  'authenticated', 'authenticated'),
  ('5ec00000-0000-4000-8000-000000000b02', 'sec-m11-custodio@example.test', 'authenticated', 'authenticated');
insert into public.units (id, name) values
  ('5ec10000-0000-4000-8000-000000000b01', 'SEC M11 Unidad');
insert into public.indicators (id, code, name, measurement_type, direction, green_threshold, yellow_threshold) values
  ('5ec20000-0000-4000-8000-000000000b01', 'SEC_M11_AVG', 'SEC M11 promedio', 'window_average', 'higher_is_better', 95, 90),
  ('5ec20000-0000-4000-8000-000000000b02', 'SEC_M11_CUM', 'SEC M11 acumulado', 'cumulative_target', 'higher_is_better', 100, 80);
insert into public.user_roles (user_id, role, unit_id, indicator_id) values
  ('5ec00000-0000-4000-8000-000000000b01', 'kpi_manager', null, null),
  ('5ec00000-0000-4000-8000-000000000b02', 'custodian',   null, '5ec20000-0000-4000-8000-000000000b01'),
  ('5ec00000-0000-4000-8000-000000000b02', 'custodian',   null, '5ec20000-0000-4000-8000-000000000b02');
insert into public.targets (id, unit_id, indicator_id, month, target_value) values
  ('5ec30000-0000-4000-8000-000000000b01', '5ec10000-0000-4000-8000-000000000b01', '5ec20000-0000-4000-8000-000000000b02', '2031-01', 10);
insert into public.commitments (id, unit_id, indicator_id, period, package_total, package_by_category, created_by) values
  ('5ec50000-0000-4000-8000-000000000b01', '5ec10000-0000-4000-8000-000000000b01', '5ec20000-0000-4000-8000-000000000b02', '2031-Q1', 30,
   '{"P0P1": 20, "P2P3": 10}', '5ec00000-0000-4000-8000-000000000b02');
insert into public.commitments (id, unit_id, indicator_id, period, green_override, yellow_override, created_by) values
  ('5ec50000-0000-4000-8000-000000000b02', '5ec10000-0000-4000-8000-000000000b01', '5ec20000-0000-4000-8000-000000000b01', '2031-01', 97, 92,
   '5ec00000-0000-4000-8000-000000000b02');

set local role authenticated;

-- Gestora: umbrales y metas ------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000b01","role":"authenticated"}';
select throws_ok(
  $$ update public.indicators set green_threshold = '9.007199254740992e15' where id = '5ec20000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'gestora: green_threshold 9.007199254740992e15 (= 2^53, notación exponencial) rechazado');
select throws_ok(
  $$ update public.indicators set green_threshold = '0.9007199254740992E+16' where id = '5ec20000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'gestora: green_threshold 0.9007199254740992E+16 rechazado');
select throws_ok(
  $$ update public.indicators set yellow_threshold = '-9007199254740992' where id = '5ec20000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_yellow_threshold_safe"',
  'gestora: yellow_threshold -2^53 rechazado');
select throws_ok(
  $$ update public.indicators set green_threshold = green_threshold * 1e300 where id = '5ec20000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "indicators" violates check constraint "indicators_green_threshold_safe"',
  'gestora: UPDATE calculado (x * 1e300) rechazado');
select throws_ok(
  $$ update public.targets set target_value = target_value * 1e20 where id = '5ec30000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'gestora: target_value calculado (x * 1e20) rechazado');
select throws_ok(
  $$ update public.targets set target_value = '  1E400  ' where id = '5ec30000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'gestora: target_value "  1E400  " (mayúsculas y espacios) rechazado');
select throws_ok(
  $$ insert into public.targets (unit_id, indicator_id, month, target_value)
     values ('5ec10000-0000-4000-8000-000000000b01', '5ec20000-0000-4000-8000-000000000b02', '2031-01', '1e400')
     on conflict (unit_id, indicator_id, month) do update set target_value = excluded.target_value $$,
  '23514', 'new row for relation "targets" violates check constraint "targets_target_value_safe"',
  'gestora: upsert de target_value a 1e400 rechazado');
select lives_ok(
  $$ update public.targets set target_value = 9007199254740991 where id = '5ec30000-0000-4000-8000-000000000b01' $$,
  'gestora: target_value 2^53 - 1 aceptado (control positivo bajo RLS)');

-- Custodio: compromisos -----------------------------------------------------------
set local request.jwt.claims = '{"sub":"5ec00000-0000-4000-8000-000000000b02","role":"authenticated"}';
select throws_ok(
  $$ update public.commitments set green_override = 9007199254740992 where id = '5ec50000-0000-4000-8000-000000000b02' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_green_override_safe"',
  'custodio: green_override 2^53 rechazado');
select throws_ok(
  $$ update public.commitments set yellow_override = '-1e400' where id = '5ec50000-0000-4000-8000-000000000b02' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_yellow_override_safe"',
  'custodio: yellow_override -1e400 rechazado');
select throws_ok(
  $$ update public.commitments set package_total = '9.007199254740992e15' where id = '5ec50000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_total_safe"',
  'custodio: package_total en notación exponencial (= 2^53) rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = package_by_category || '{"P2P3": 1e400}'
      where id = '5ec50000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: UPDATE parcial con || añade 1e400 → rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = jsonb_set(package_by_category, '{P0P1}', '1e400')
      where id = '5ec50000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: UPDATE parcial con jsonb_set a 1e400 → rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 9.007199254740992e15}'
      where id = '5ec50000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: package_by_category 9.007199254740992e15 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": -9007199254740992}'
      where id = '5ec50000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: package_by_category -2^53 rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": "100"}'
      where id = '5ec50000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: package_by_category con cadena numérica pequeña ("100") rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"__proto__": 1e400}'
      where id = '5ec50000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: clave __proto__ con 1e400 rechazada (se revisan todas las claves)');
select throws_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1e400}'
      where id = '5ec50000-0000-4000-8000-000000000b01' $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: clave con escapes unicode y 1e400 rechazada');
select throws_ok(
  $$ update public.commitments set package_by_category = '[1e400]'
      where id = '5ec50000-0000-4000-8000-000000000b01' $$,
  '23514', null, 'custodio: package_by_category arreglo (no objeto) rechazado');
select throws_ok(
  $$ update public.commitments set package_by_category = '1e400'
      where id = '5ec50000-0000-4000-8000-000000000b01' $$,
  '23514', null, 'custodio: package_by_category escalar 1e400 rechazado');
select throws_ok(
  $$ insert into public.commitments (unit_id, indicator_id, period, package_total, package_by_category, created_by)
     values ('5ec10000-0000-4000-8000-000000000b01', '5ec20000-0000-4000-8000-000000000b02', '2031-Q2', 10,
             '{"P0P1": 10, "P2P3": 1e400}', '5ec00000-0000-4000-8000-000000000b02') $$,
  '23514', 'new row for relation "commitments" violates check constraint "commitments_package_by_category_safe"',
  'custodio: INSERT de compromiso con 1e400 en la segunda clave rechazado');
select lives_ok(
  $$ update public.commitments set package_by_category = '{"P0P1": 1e400, "P0P1": 5, "P2P3": -0}'
      where id = '5ec50000-0000-4000-8000-000000000b01' $$,
  'custodio: clave duplicada (JSONB conserva la última) y -0 aceptados');
select is(
  (select package_by_category::text from public.commitments where id = '5ec50000-0000-4000-8000-000000000b01'),
  '{"P0P1": 5, "P2P3": 0}', 'clave duplicada: lo guardado es el último valor (seguro), no 1e400');

reset role;
select is(
  (select green_threshold::text || '|' || yellow_threshold::text from public.indicators where id = '5ec20000-0000-4000-8000-000000000b01')
  || '#' || (select package_total::text from public.commitments where id = '5ec50000-0000-4000-8000-000000000b01')
  || '#' || (select green_override::text || '|' || yellow_override::text from public.commitments where id = '5ec50000-0000-4000-8000-000000000b02'),
  '95|90#30#97|92', 'umbrales, paquete y overrides conservan su valor tras los intentos rechazados');
select is(
  (select count(*)::int from public.commitments where id not in (
     '5ec50000-0000-4000-8000-000000000b01', '5ec50000-0000-4000-8000-000000000b02')
     and unit_id = '5ec10000-0000-4000-8000-000000000b01'),
  0, 'no quedó ningún compromiso creado por los intentos rechazados');
select ok(
  not jsonb_path_exists(
    (select coalesce(jsonb_agg(package_by_category), '[]') from public.commitments where package_by_category is not null),
    'strict $[*].* ? (@.type() != "number" || @.abs() >= 9007199254740992)'),
  'ningún package_by_category guardado (incluida la semilla) incumple el tope');

select * from finish();
rollback;
