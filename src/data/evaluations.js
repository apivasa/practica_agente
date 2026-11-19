// V-01/V-02: evaluaciones (solo lectura; las escribe el backend). RLS: gestora y comité leen
// todas; el líder, las de sus unidades; el custodio, las de sus indicadores.
import { db, raise, MSG_LOAD } from './client.js';

const COLUMNS = 'id, unit_id, indicator_id, month, color, value, sample_size, reason, escalation_level, restrictions, evaluated_at';

/**
 * Evaluaciones de los últimos `months` meses evaluados (por defecto 12), opcionalmente de una unidad.
 * @param {{ unitId?: string, since?: string }} [opts] since: mes mínimo 'YYYY-MM'
 */
export async function listEvaluations({ unitId, since } = {}) {
  let q = db().from('evaluations').select(COLUMNS);
  if (unitId) q = q.eq('unit_id', unitId);
  if (since) q = q.gte('month', since);
  const { data, error } = await q.order('month', { ascending: false }).limit(2000);
  if (error) raise(error, MSG_LOAD);
  return data ?? [];
}
