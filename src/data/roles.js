// Roles de usuarios (user_roles). RLS: la gestora lee y escribe todas las filas.
import { db, raise, MSG_LOAD, MSG_SAVE } from './client.js';

/** Todas las filas de rol custodian (para la gestora). */
export async function listCustodianRoles() {
  const { data, error } = await db()
    .from('user_roles')
    .select('id, user_id, role, indicator_id')
    .eq('role', 'custodian');
  if (error) raise(error, MSG_LOAD);
  return data ?? [];
}

export async function deleteRoles(ids) {
  if (!ids.length) return;
  const { error } = await db().from('user_roles').delete().in('id', ids).eq('role', 'custodian');
  if (error) raise(error, MSG_SAVE);
}

export async function addCustodianRole(userId, indicatorId) {
  const { error } = await db()
    .from('user_roles')
    .insert({ user_id: userId, role: 'custodian', unit_id: null, indicator_id: indicatorId });
  // 23505: la fila ya existe (otra pestaña): el estado final es el pedido.
  if (error && error.code !== '23505') raise(error, MSG_SAVE);
}
