-- M-12: residuales de seguridad de M-11 (docs/seguridad/hallazgos.md).
--
-- H-M11-01: `indicators.thresholds_by_category` solo exigía `jsonb_typeof = 'object'`; la
-- gestora podía guardar `{"P0P1": {"green": 1e400, "yellow": 90}}` y `JSON.parse` lo volvía
-- Infinity (el umbral por categoría desaparecía en silencio). Ahora: NULL u objeto cuyos
-- valores son objetos con exactamente las claves `green` y `yellow`, ambas números JSON con
-- |v| < 2^53 (Number.MAX_SAFE_INTEGER + 1). Es la forma que produce el formulario
-- (src/lib/indicator-form.js: `{ [cat]: { green, yellow } }`, ambos obligatorios) y la de la
-- semilla. JSONB no admite NaN ni Infinity, así que el número llega finito al front.
--
-- H-M11-02: `measurements.value` tenía el CHECK de finitud de M-09 pero no tope; en
-- indicadores sin categorías un `1e400` entraba. Mismo tope |v| < 2^53. En PostgreSQL
-- abs('NaN') < x es falso, así que tampoco deja pasar NaN; NaN e ±Infinity ya los frena
-- `measurements_value_finite` (que, por orden de nombre, se reporta antes que este).
--
-- H-M11-03: `commitments.package_by_category` solo tenía el tope de M-11. Ahora cada valor
-- es además un entero >= 0 (rechaza negativos, fracciones, `1e-16000` y
-- `9007199254740991.9999`), como ya valida el front (src/lib/commitment-form.js) y el motor
-- (engine/commitment.js). NO se restringen las claves a `P0P1`/`P2P3`: el formulario de
-- compromisos usa como claves las categorías del indicador, que la gestora nombra libremente,
-- y `total` en los indicadores de meta acumulada sin categorías (e2e/m07-targets.spec.js);
-- limitar las claves rompería ese flujo. El nombre `_whole` ordena después de
-- `commitments_package_by_category_safe`, así que un 1e400 sigue reportando el CHECK de M-11.
--
-- Igual que M-11: jsonpath (inmutable) y no funciones propias, sin superficie RPC nueva ni
-- grants. Modo strict: `$.*` solo recorre el nivel indicado; el CASE evalúa jsonpath solo
-- sobre objetos (en strict, `$.*` sobre un arreglo o escalar daría error en lugar de 23514).
-- Para presencia de claves se usa lax: en strict, `exists(@.green)` sin la clave es
-- "desconocido" y el filtro no seleccionaría la fila.
--
-- Aditiva y no destructiva. La semilla (supabase/seed.sql) cumple. Verificación previa a
-- producción (compuerta del usuario): correr las consultas comentadas del final contra
-- producción; todas deben devolver 0 filas.

alter table public.indicators
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
                'strict $.* ? (@.type() == "object").* ? (@.type() != "number" || @.abs() >= 9007199254740992)')
  end);

alter table public.measurements
  add constraint measurements_value_safe
  check (value is null or abs(value) < 9007199254740992);

alter table public.commitments
  add constraint commitments_package_by_category_whole
  check (package_by_category is null or case
    when jsonb_typeof(package_by_category) <> 'object' then false
    else not jsonb_path_exists(package_by_category,
                'strict $.* ? (@.type() != "number" || @ < 0 || @ != @.floor())')
  end);

-- Verificación previa a producción (solo lectura; deben devolver 0 filas):
--
-- select id, code, thresholds_by_category from public.indicators
--  where jsonb_typeof(thresholds_by_category) <> 'object'
--     or jsonb_path_exists(thresholds_by_category, 'strict $.* ? (@.type() != "object")')
--     or jsonb_path_exists(thresholds_by_category,
--          'strict $.* ? (@.type() == "object").keyvalue() ? (@.key != "green" && @.key != "yellow")')
--     or jsonb_path_exists(thresholds_by_category,
--          'lax $.* ? (@.type() == "object") ? (!exists(@.green) || !exists(@.yellow))')
--     or jsonb_path_exists(thresholds_by_category,
--          'strict $.* ? (@.type() == "object").* ? (@.type() != "number" || @.abs() >= 9007199254740992)');
--
-- select id, indicator_id, measured_on, value from public.measurements
--  where not (abs(value) < 9007199254740992);
--
-- select id, package_by_category from public.commitments
--  where jsonb_typeof(package_by_category) <> 'object'
--     or jsonb_path_exists(package_by_category,
--          'strict $.* ? (@.type() != "number" || @ < 0 || @ != @.floor())');
