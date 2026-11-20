// V-01/V-02: bandeja de alertas propias. RLS: cada usuario lee las suyas (gestora y comité
// leen todas, por eso se filtra por destinatario) y solo puede actualizar read_at.
import { db, raise, MSG_LOAD, MSG_SAVE } from './client.js';

const COLUMNS = 'id, unit_id, recipient_user_id, kind, payload, sent_at, read_at';

/** Alertas dirigidas al usuario, las más recientes primero. */
export async function listMyAlerts(userId, limit = 50) {
  const { data, error } = await db().from('alerts').select(COLUMNS)
    .eq('recipient_user_id', userId)
    .order('sent_at', { ascending: false }).limit(limit);
  if (error) raise(error, MSG_LOAD);
  return data ?? [];
}

/** Marca una alerta propia como leída. Devuelve la fila actualizada. */
export async function markAlertRead(id) {
  const { data, error } = await db().from('alerts')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id).is('read_at', null)
    .select(COLUMNS);
  if (error) raise(error, MSG_SAVE);
  return data?.[0] ?? null;
}
