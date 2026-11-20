-- M-14 (H-ARQ-M13-01, docs/adr/0005): alinear el borde de los CHECK `_safe` con el redondeo
-- de JavaScript.
--
-- M-11 y M-12 comparan el numeric exacto con `abs(v) < 9007199254740992` (2^53). Pero
-- `JSON.parse` redondea al double más cercano: en [2^52, 2^53) los doubles van de 1 en 1 y el
-- empate se resuelve al par, así que todo valor en [2^53 - 0,5, 2^53) llega al front y al
-- motor como 2^53, que engine/numeric.js rechaza. Un umbral así metido por API hace fallar
-- `normalizeIndicator` (scripts/lib/run.js) en la evaluación mensual. Con
-- `abs(v) < 9007199254740991.5` "pasa en la BD" equivale a "pasa en el motor":
-- 9007199254740991.4 se lee como 2^53 - 1 (válido) y 9007199254740991.5 como 2^53 (inválido).
-- Simétrico en negativos.
--
-- Se reemplazan los CHECK con el MISMO nombre (las pruebas esperan esos nombres). Cada tabla
-- se cambia en una sola sentencia ALTER TABLE (DROP CONSTRAINT + ADD CONSTRAINT), que es
-- atómica: no hay instante sin restricción. No borra columnas ni datos; el ADD valida las filas
-- existentes y falla (sin aplicar nada) si alguna queda fuera, por eso la verificación previa.
--
-- Fuera de alcance, ya coherentes:
--  * Trigger de M-09 (private.check_measurement_category): exige entero y `value <= 2^53 - 1`
--    (`> 9007199254740991` rechaza). Un entero <= 2^53 - 1 es exacto en double: coherente.
--  * `commitments_package_by_category_whole` (M-12): exige entero >= 0; junto con el tope, el
--    máximo es 2^53 - 1, exacto en double: coherente.
--
-- La semilla (supabase/seed.sql) cumple. Verificación previa a producción (compuerta del
-- usuario): correr las consultas comentadas del final contra producción; todas deben devolver
-- 0 filas.

alter table public.indicators
  drop constraint indicators_green_threshold_safe,
  add constraint indicators_green_threshold_safe
  check (abs(green_threshold) < 9007199254740991.5),
  drop constraint indicators_yellow_threshold_safe,
  add constraint indicators_yellow_threshold_safe
  check (abs(yellow_threshold) < 9007199254740991.5),
  drop constraint indicators_thresholds_by_category_safe,
  add constraint indicators_thresholds_by_category_safe
  check (thresholds_by_category is null or case
    when jsonb_typeof(thresholds_by_category) <> 'object' then false
    else not jsonb_path_exists(thresholds_by_category,
                'strict $.* ? (@.type() != "object")')
     and not jsonb_path_exists(thresholds_by_category,
                'strict $.* ? (@.type() == "object").keyvalue() ? (@.key != "green" && @.key != "yellow")')
     and not jsonb_path_exists(thresholds_by_category,
                'lax $.* ? (@.type() == "object") ? (!exists(@.green) || !exists(@.yellow))')
     and not jsonb_path_exists(thresholds_by_category,
                'strict $.* ? (@.type() == "object").* ? (@.type() != "number" || @.abs() >= 9007199254740991.5)')
  end);

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
  check (package_by_category is null or not jsonb_path_exists(
    package_by_category,
    'strict $.* ? (@.type() != "number" || @.abs() >= 9007199254740991.5)'));

alter table public.targets
  drop constraint targets_target_value_safe,
  add constraint targets_target_value_safe
  check (abs(target_value) < 9007199254740991.5);

alter table public.measurements
  drop constraint measurements_value_safe,
  add constraint measurements_value_safe
  check (value is null or abs(value) < 9007199254740991.5);

-- Verificación previa a producción (solo lectura; deben devolver 0 filas):
--
-- select id, code, green_threshold, yellow_threshold, thresholds_by_category
--   from public.indicators
--  where not (abs(green_threshold) < 9007199254740991.5)
--     or not (abs(yellow_threshold) < 9007199254740991.5)
--     or jsonb_path_exists(thresholds_by_category,
--          'strict $.* ? (@.type() == "object").* ? (@.type() != "number" || @.abs() >= 9007199254740991.5)');
--
-- select id, green_override, yellow_override, package_total, package_by_category
--   from public.commitments
--  where not (abs(green_override) < 9007199254740991.5)
--     or not (abs(yellow_override) < 9007199254740991.5)
--     or not (abs(package_total) < 9007199254740991.5)
--     or jsonb_path_exists(package_by_category,
--          'strict $.* ? (@.type() != "number" || @.abs() >= 9007199254740991.5)');
--
-- select id, target_value from public.targets
--  where not (abs(target_value) < 9007199254740991.5);
--
-- select id, indicator_id, measured_on, value from public.measurements
--  where not (abs(value) < 9007199254740991.5);
