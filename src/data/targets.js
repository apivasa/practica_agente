// V-01: metas parciales mensuales (lectura). RLS: el líder lee las de su unidad.
import { db, raise, MSG_LOAD } from './client.js';

export async function listUnitTargets(unitId, month) {
  const { data, error } = await db().from('targets')
    .select('id, unit_id, indicator_id, month, target_value')
    .eq('unit_id', unitId).eq('month', month);
  if (error) raise(error, MSG_LOAD);
  return data ?? [];
}
