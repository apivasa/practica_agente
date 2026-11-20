-- M-10 (H-M09-01): `numeric` admite 'NaN', 'Infinity' y '-Infinity', y en PostgreSQL
-- 'NaN' >= 0 es verdadero (NaN es mayor que cualquier número). Los CHECK originales
-- (target_value >= 0, package_total >= 0, indicators_thresholds_coherent) los dejaban pasar.
-- Mismo criterio que measurements_value_finite (M-09) para el resto de columnas numeric que
-- configuran usuarios: indicators (umbrales), commitments (overrides y paquete) y targets.
-- evaluations.value solo lo escribe el backend con el motor, que descarta no finitos.
--
-- Aditiva y no destructiva. Verificación previa a producción (compuerta del usuario): correr
-- las consultas comentadas del final contra producción; todas deben devolver 0 filas.

alter table public.indicators
  add constraint indicators_green_threshold_finite
  check (green_threshold <> 'NaN'::numeric and green_threshold < 'Infinity'::numeric
         and green_threshold > '-Infinity'::numeric),
  add constraint indicators_yellow_threshold_finite
  check (yellow_threshold <> 'NaN'::numeric and yellow_threshold < 'Infinity'::numeric
         and yellow_threshold > '-Infinity'::numeric);

alter table public.commitments
  add constraint commitments_green_override_finite
  check (green_override is null or (green_override <> 'NaN'::numeric
         and green_override < 'Infinity'::numeric and green_override > '-Infinity'::numeric)),
  add constraint commitments_yellow_override_finite
  check (yellow_override is null or (yellow_override <> 'NaN'::numeric
         and yellow_override < 'Infinity'::numeric and yellow_override > '-Infinity'::numeric)),
  add constraint commitments_package_total_finite
  check (package_total is null or (package_total <> 'NaN'::numeric
         and package_total < 'Infinity'::numeric and package_total > '-Infinity'::numeric));

alter table public.targets
  add constraint targets_target_value_finite
  check (target_value <> 'NaN'::numeric and target_value < 'Infinity'::numeric
         and target_value > '-Infinity'::numeric);

-- Verificación previa a producción (solo lectura; deben devolver 0 filas):
--
-- select id, green_threshold, yellow_threshold from public.indicators
--  where green_threshold in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
--     or yellow_threshold in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric);
--
-- select id, green_override, yellow_override, package_total from public.commitments
--  where green_override in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
--     or yellow_override in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
--     or package_total in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric);
--
-- select id, target_value from public.targets
--  where target_value in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric);
