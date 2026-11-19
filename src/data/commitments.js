// Compromisos. RLS: el custodio lee y escribe los de sus indicadores. Sin DELETE.
import { db, raise, MSG_LOAD, MSG_SAVE } from './client.js';

const COLUMNS = 'id, unit_id, indicator_id, period, green_override, yellow_override, package_total, '
  + 'package_by_category, notes, updated_at';

export async function listCommitments(indicatorId) {
  const { data, error } = await db()
    .from('commitments').select(COLUMNS).eq('indicator_id', indicatorId)
    .order('period', { ascending: false });
  if (error) raise(error, MSG_LOAD);
  return data ?? [];
}

/**
 * Crea o actualiza el compromiso de (unidad, indicador, periodo). Sin upsert:
 * unit_id e indicator_id no son actualizables por la API (H-F03-01).
 * @param {object} fields period, green_override, yellow_override, package_by_category, package_total, notes
 */
export async function saveCommitment(unitId, indicatorId, fields) {
  const found = await db().from('commitments').select('id')
    .eq('unit_id', unitId).eq('indicator_id', indicatorId).eq('period', fields.period).maybeSingle();
  if (found.error) raise(found.error, MSG_SAVE);
  const q = found.data
    ? db().from('commitments').update(fields).eq('id', found.data.id)
    : db().from('commitments').insert({ ...fields, unit_id: unitId, indicator_id: indicatorId });
  const { data, error } = await q.select(COLUMNS).single();
  if (error) raise(error, MSG_SAVE, { '23505': 'Ya existe un compromiso para esa unidad y periodo.' });
  return data;
}
