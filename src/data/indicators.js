// Indicadores. RLS: cualquier usuario con rol lee; solo la gestora escribe.
import { db, raise, MSG_LOAD, MSG_SAVE } from './client.js';
import { custodianAssignmentPlan } from '../lib/indicator-form.js';
import { listCustodianRoles, deleteRoles, addCustodianRole } from './roles.js';

const COLUMNS = 'id, code, name, description, measurement_type, direction, window_days, green_threshold, '
  + 'yellow_threshold, thresholds_by_category, frequency, min_sample, source, custodian_user_id, active';

const SAVE_ERRORS = {
  '23505': 'Ya existe un indicador con ese código.',
  '23514': 'Los datos no cumplen las reglas del indicador (revisa los umbrales).',
};

export async function listIndicators() {
  const { data, error } = await db().from('indicators').select(COLUMNS).order('code');
  if (error) raise(error, MSG_LOAD);
  return data ?? [];
}

/** Indicadores activos que custodia el usuario según sus filas de user_roles. */
export async function listMyIndicators(roleRows) {
  const ids = [...new Set((roleRows ?? []).filter((r) => r.role === 'custodian').map((r) => r.indicator_id))];
  if (!ids.length) return [];
  const { data, error } = await db().from('indicators').select(COLUMNS).in('id', ids).eq('active', true).order('code');
  if (error) raise(error, MSG_LOAD);
  return data ?? [];
}

/** Crea (sin id) o actualiza un indicador. Devuelve la fila guardada. */
export async function saveIndicator(id, row) {
  const q = id
    ? db().from('indicators').update(row).eq('id', id)
    : db().from('indicators').insert(row);
  const { data, error } = await q.select(COLUMNS).single();
  if (error) raise(error, MSG_SAVE, SAVE_ERRORS);
  return data;
}

export async function setIndicatorActive(id, active) {
  const { error } = await db().from('indicators').update({ active }).eq('id', id);
  if (error) raise(error, MSG_SAVE);
}

/**
 * Deja a `userId` como único custodio del indicador (o ninguno si es vacío),
 * escribiendo user_roles (permisos) e indicators.custodian_user_id
 * (informativo) en la misma operación (ADR 0005). Orden "falla cerrado".
 */
export async function assignCustodian(indicatorId, userId) {
  const roles = await listCustodianRoles();
  const plan = custodianAssignmentPlan(indicatorId, userId, roles);
  try {
    await deleteRoles(plan.removeRoleIds);
    if (plan.addRole) await addCustodianRole(plan.setColumn, indicatorId);
    const { error } = await db().from('indicators').update({ custodian_user_id: plan.setColumn }).eq('id', indicatorId);
    if (error) raise(error, MSG_SAVE);
  } catch (err) {
    throw new Error(`La asignación del custodio quedó incompleta: ${err.message} Vuelve a guardar.`);
  }
}
