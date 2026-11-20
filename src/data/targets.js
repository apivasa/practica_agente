// Metas parciales mensuales (solo lectura). RLS: gestora, comité y custodios leen todas; el
// líder, las de su unidad (V-01). La escritura de la gestora está en target-admin.js (M-07).
import { db, raise, allPages, MSG_LOAD } from './client.js';

const COLUMNS = 'id, unit_id, indicator_id, month, target_value';

export async function listUnitTargets(unitId, month) {
  const { data, error } = await db().from('targets')
    .select(COLUMNS)
    .eq('unit_id', unitId).eq('month', month);
  if (error) raise(error, MSG_LOAD);
  return data ?? [];
}

/** M-07: metas de un indicador en un mes, todas las páginas. */
export function listIndicatorTargets(indicatorId, month) {
  return allPages(() => db().from('targets').select(COLUMNS)
    .eq('indicator_id', indicatorId).eq('month', month).order('id'));
}
