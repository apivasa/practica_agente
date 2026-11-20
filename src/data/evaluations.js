// V-01/V-02: evaluaciones (solo lectura; las escribe el backend). RLS: gestora y comité leen
// todas; el líder, las de sus unidades; el custodio, las de sus indicadores.
import { db, allPages } from './client.js';

const COLUMNS = 'id, unit_id, indicator_id, month, color, value, sample_size, reason, escalation_level, restrictions, evaluated_at';

/**
 * Evaluaciones desde un mes, opcionalmente de una unidad. Se leen todas las páginas con
 * orden total (mes desc, id) para no perder filas por max_rows (H-1).
 * @param {{ unitId?: string, since?: string }} [opts] since: mes mínimo 'YYYY-MM'
 */
export function listEvaluations({ unitId, since } = {}) {
  return allPages(() => {
    let q = db().from('evaluations').select(COLUMNS);
    if (unitId) q = q.eq('unit_id', unitId);
    if (since) q = q.gte('month', since);
    return q.order('month', { ascending: false }).order('id');
  });
}
