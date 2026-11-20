-- M-08: endurecimiento de mediciones por criticidad (VULN). Aditiva y no destructiva.
-- Verificación previa a producción (compuerta del usuario): antes de aplicarla, correr
-- las dos consultas del final de este archivo (comentadas) contra producción; ambas deben
-- devolver 0 filas. La semilla (supabase/seed.sql) cumple las dos reglas.

-- ---------------------------------------------------------------------------
-- A4 / H-M06-QA-02: una meta acumulada solo admite "más es mejor" (engine/validateIndicator
-- aplica la misma regla en el formulario).
-- ---------------------------------------------------------------------------
alter table public.indicators
  add constraint indicators_cumulative_direction
  check (not (measurement_type = 'cumulative_target' and direction = 'lower_is_better'));

-- ---------------------------------------------------------------------------
-- H-M06-01: en un indicador de meta acumulada con umbrales por categoría, cada medición
-- lleva categoría P0P1 o P2P3 y un valor entero >= 0 (sea resuelta, detectada o sin kind,
-- que el motor trata como resuelta). Es el mismo criterio que engine/rows.js usa para
-- descartar filas cargadas por la API; aquí se impide que entren.
--
-- Trigger AFTER (no BEFORE): así RLS evalúa antes la política de inserción y un rol sin
-- permiso recibe el mismo 403 de siempre, sin saber si la fila habría sido válida.
-- Security definer: lee la fila de `indicators` aunque el rol que inserta no la vea.
-- ---------------------------------------------------------------------------
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
  if new.value is null or new.value < 0 or new.value <> trunc(new.value) then
    raise exception 'El valor de la medición debe ser un entero mayor o igual que 0'
      using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function private.check_measurement_category() from public, anon, authenticated;

create trigger measurements_category_guard
  after insert or update on public.measurements
  for each row execute function private.check_measurement_category();

-- Verificación previa a producción (solo lectura; deben devolver 0 filas):
--
-- select id, code from public.indicators
--  where measurement_type = 'cumulative_target' and direction = 'lower_is_better';
--
-- select m.id, m.category, m.value
--   from public.measurements m
--   join public.indicators i on i.id = m.indicator_id
--  where i.measurement_type = 'cumulative_target'
--    and i.thresholds_by_category <> '{}'::jsonb
--    and (m.category is null or m.category not in ('P0P1', 'P2P3')
--         or m.value is null or m.value <> trunc(m.value));
