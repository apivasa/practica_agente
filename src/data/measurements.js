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
