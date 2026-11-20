// M-07: escritura de metas mensuales, solo para la pantalla de la gestora. RLS: solo
// kpi_manager inserta y actualiza `targets` (políticas targets_insert / targets_update).
// La lectura sigue en targets.js, que se mantiene de solo lectura (lo usa el líder, V-01).
import { db, raise, MSG_SAVE } from './client.js';

const COLUMNS = 'id, unit_id, indicator_id, month, target_value';

/**
 * M-07: crea o actualiza la meta de (unidad, indicador, mes). Sin upsert: si existe, solo se
 * actualiza `target_value`.
 */
export async function saveTarget(unitId, indicatorId, month, targetValue) {
  const found = await db().from('targets').select('id')
    .eq('unit_id', unitId).eq('indicator_id', indicatorId).eq('month', month).maybeSingle();
  if (found.error) raise(found.error, MSG_SAVE);
  const q = found.data
    ? db().from('targets').update({ target_value: targetValue }).eq('id', found.data.id)
    : db().from('targets').insert({ unit_id: unitId, indicator_id: indicatorId, month, target_value: targetValue });
  const { data, error } = await q.select(COLUMNS).single();
  if (error) {
    raise(error, MSG_SAVE, {
      '23505': 'Ya existe una meta para esa unidad y mes.',
      '23514': 'La meta no cumple las reglas (debe ser >= 0 y el mes AAAA-MM).',
    });
  }
  return data;
}
