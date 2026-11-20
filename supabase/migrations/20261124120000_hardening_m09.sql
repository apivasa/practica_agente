-- M-09: endurecimiento de hallazgos bajos de M-07 y M-08. Aditiva y no destructiva.
-- Verificación previa a producción (compuerta del usuario): antes de aplicarla, correr las
-- dos consultas del final de este archivo (comentadas) contra producción; ambas deben
-- devolver 0 filas. La semilla (supabase/seed.sql) cumple las reglas.

-- ---------------------------------------------------------------------------
-- H-M07-01: authenticated solo actualiza `target_value` de una meta. Antes tenía UPDATE de
-- tabla y la gestora podía mover una meta a otra unidad, indicador o mes conservando su id.
-- src/data/target-admin.js solo envía { target_value }; la política targets_update (RLS)
-- sigue limitando quién actualiza.
-- ---------------------------------------------------------------------------
revoke update on public.targets from authenticated;
grant update (target_value) on public.targets to authenticated;

-- ---------------------------------------------------------------------------
-- H-M08-01: `numeric` admite 'NaN', 'Infinity' y '-Infinity'. En PostgreSQL 'NaN' >= 0 es
-- verdadero, así que el CHECK original (value >= 0) los dejaba pasar. El motor descarta los
-- valores no finitos (engine/measure.js, engine/rows.js), y aquí se impide que entren.
-- ---------------------------------------------------------------------------
alter table public.measurements
  add constraint measurements_value_finite
  check (value is null or (value <> 'NaN'::numeric and value < 'Infinity'::numeric and value > '-Infinity'::numeric));

-- Trigger de categoría (M-08): además de entero >= 0, el valor tiene que ser un entero
-- seguro de JavaScript (<= Number.MAX_SAFE_INTEGER = 2^53 - 1), el mismo criterio que
-- engine/rows.js (Number.isSafeInteger) usa para descartar filas. 'NaN' se compara aparte
-- porque en PostgreSQL NaN = trunc(NaN) es verdadero.
create or replace function private.check_measurement_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ind record;
begin
  select i.measurement_type, i.thresholds_by_category
    into ind
    from public.indicators i
   where i.id = new.indicator_id;
  if not found
     or ind.measurement_type <> 'cumulative_target'
     or ind.thresholds_by_category = '{}'::jsonb then
    return null;
  end if;
  if new.category is null or new.category not in ('P0P1', 'P2P3') then
    raise exception 'La categoría de la medición debe ser P0P1 o P2P3'
      using errcode = '23514';
  end if;
  if new.value is null
     or new.value = 'NaN'::numeric
     or new.value < 0
     or new.value > 9007199254740991
     or new.value <> trunc(new.value) then
    raise exception 'El valor de la medición debe ser un entero mayor o igual que 0 y menor que 2^53'
      using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function private.check_measurement_category() from public, anon, authenticated;

-- Verificación previa a producción (solo lectura; deben devolver 0 filas):
--
-- select id, value from public.measurements
--  where value = 'NaN'::numeric or value = 'Infinity'::numeric or value = '-Infinity'::numeric;
--
-- select m.id, m.value
--   from public.measurements m
--   join public.indicators i on i.id = m.indicator_id
--  where i.measurement_type = 'cumulative_target'
--    and i.thresholds_by_category <> '{}'::jsonb
--    and m.value > 9007199254740991;
