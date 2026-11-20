-- M-11 (H-M10-01): tope de magnitud en las columnas numeric que configuran usuarios.
-- M-10 dejó fuera NaN e ±Infinity, pero un valor como 1e400 es finito en PostgreSQL y
-- PostgREST lo devuelve como literal JSON; `JSON.parse` en el front y en el motor lo vuelve
-- Infinity. Mismo criterio que las mediciones (M-09): |v| < 2^53 (Number.MAX_SAFE_INTEGER + 1).
-- En PostgreSQL abs('NaN') < x es falso, así que estos CHECK tampoco dejan pasar NaN.
--
-- `commitments.package_by_category` (JSONB): cada valor del objeto debe ser un número JSON
-- (no texto, null, booleano, arreglo ni objeto) con |v| < 2^53. JSONB no admite NaN ni
-- Infinity, así que con esto el valor llega finito al front. Se usa jsonpath (inmutable) y no
-- una función propia: no queda una función nueva expuesta por PostgREST ni hacen falta
-- permisos de EXECUTE para los roles que escriben. Modo strict: `$.*` recorre solo el primer
-- nivel; en un valor no numérico, `.abs()` daría error, pero `||` ya es verdadero por el tipo.
--
-- Aditiva y no destructiva. La semilla (supabase/seed.sql) cumple. Verificación previa a
-- producción (compuerta del usuario): correr las consultas comentadas del final contra
-- producción; todas deben devolver 0 filas.

alter table public.indicators
  add constraint indicators_green_threshold_safe
  check (abs(green_threshold) < 9007199254740992),
  add constraint indicators_yellow_threshold_safe
  check (abs(yellow_threshold) < 9007199254740992);

alter table public.commitments
  add constraint commitments_green_override_safe
  check (green_override is null or abs(green_override) < 9007199254740992),
  add constraint commitments_yellow_override_safe
  check (yellow_override is null or abs(yellow_override) < 9007199254740992),
  add constraint commitments_package_total_safe
  check (package_total is null or abs(package_total) < 9007199254740992),
  add constraint commitments_package_by_category_safe
  check (package_by_category is null or not jsonb_path_exists(
    package_by_category,
    'strict $.* ? (@.type() != "number" || @.abs() >= 9007199254740992)'));

alter table public.targets
  add constraint targets_target_value_safe
  check (abs(target_value) < 9007199254740992);

-- Verificación previa a producción (solo lectura; deben devolver 0 filas):
--
-- select id, green_threshold, yellow_threshold from public.indicators
--  where not (abs(green_threshold) < 9007199254740992)
--     or not (abs(yellow_threshold) < 9007199254740992);
--
-- select id, green_override, yellow_override, package_total, package_by_category
--   from public.commitments
--  where not (abs(green_override) < 9007199254740992)
--     or not (abs(yellow_override) < 9007199254740992)
--     or not (abs(package_total) < 9007199254740992)
--     or jsonb_path_exists(package_by_category,
--          'strict $.* ? (@.type() != "number" || @.abs() >= 9007199254740992)');
--
-- select id, target_value from public.targets
--  where not (abs(target_value) < 9007199254740992);
