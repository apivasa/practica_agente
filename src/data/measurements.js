// Mediciones. RLS: el custodio lee y escribe las de sus indicadores (source manual).
import { db, raise, MSG_LOAD, MSG_SAVE } from './client.js';
import { toMeasurementRow } from '../lib/measurement-form.js';

const COLUMNS = 'id, unit_id, indicator_id, measured_on, value, app_id, compliant, category, kind, created_at';

export async function listRecentMeasurements(indicatorId, limit = 20) {
  const { data, error } = await db()
    .from('measurements').select(COLUMNS).eq('indicator_id', indicatorId)
    .order('measured_on', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
  if (error) raise(error, MSG_LOAD);
  return data ?? [];
}

/** Inserta todas las filas en una sola sentencia: o se guardan todas o ninguna. */
export async function insertMeasurements(indicatorId, rows) {
  if (!rows.length) return 0;
  const { error } = await db().from('measurements').insert(rows.map((r) => toMeasurementRow(indicatorId, r)));
  if (error) raise(error, MSG_SAVE);
  return rows.length;
}

const PAGE = 1000;

/** Lee todas las páginas de una consulta (PostgREST limita las filas por respuesta). */
async function allPages(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) raise(error, MSG_LOAD);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** V-01: mediciones de una unidad entre dos fechas (RLS: el líder lee las de su unidad). */
export function listUnitMeasurements(unitId, from, to) {
  return allPages(() => db().from('measurements').select(COLUMNS)
    .eq('unit_id', unitId).gte('measured_on', from).lte('measured_on', to)
    .order('measured_on').order('id'));
}

/** V-03: unidad, indicador y fecha de las mediciones entre dos fechas (gestora: todas). */
export function listMeasurementDates(from, to) {
  return allPages(() => db().from('measurements').select('id, unit_id, indicator_id, measured_on')
    .gte('measured_on', from).lte('measured_on', to)
    .order('measured_on').order('id'));
}
