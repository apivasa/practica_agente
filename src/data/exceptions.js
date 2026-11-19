// Acceso a datos de excepciones (ADR 0009: único lugar que llama a Supabase
// para este dominio). RLS decide qué ve y qué escribe cada rol.
import { db, raise, MSG_LOAD } from './client.js';
import { MSG_FORBIDDEN, MSG_RULES, MSG_GENERIC } from '../lib/exceptions-logic.js';

const COLUMNS = 'id, unit_id, scope, reason, change_ref, expires_on, approved_by, created_at, revoked_at';
const BY_CODE = { 42501: MSG_FORBIDDEN, 23514: MSG_RULES, 23502: MSG_RULES };

/** Todas las excepciones visibles para el usuario (el comité ve todas). */
export async function listExceptions() {
  const { data, error } = await db().from('exceptions').select(COLUMNS).order('created_at', { ascending: false });
  if (error) raise(error, MSG_LOAD);
  return data ?? [];
}

/**
 * Aprueba una excepción. approved_by lo pone la BD (auth.uid()).
 * @param {{ unitId: string, scope: 'change_start' | 'all', reason: string, changeRef: string | null, expiresOn: string }} value
 *   ya validado con validateExceptionDraft (engine/exceptions.js)
 */
export async function createException(value) {
  const { error } = await db().from('exceptions').insert({
    unit_id: value.unitId,
    scope: value.scope,
    reason: value.reason,
    change_ref: value.scope === 'change_start' ? value.changeRef : null,
    expires_on: value.expiresOn,
  });
  if (error) raise(error, MSG_GENERIC, BY_CODE);
}

/** Revoca una excepción propia. La hora y el autor los fija la BD. */
export async function revokeException(id) {
  const { data, error } = await db()
    .from('exceptions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) raise(error, MSG_GENERIC, BY_CODE);
  if (!data || data.length === 0) throw new Error(MSG_FORBIDDEN);
}
