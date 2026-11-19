// Acceso común a Supabase para la capa de datos (ADR 0009). Los errores se
// traducen a mensajes en español aptos para mostrar; nunca se expone el error
// crudo de PostgREST.
import { getSupabase } from '../lib/supabase.js';
import { MSG_NOT_CONFIGURED } from '../lib/session.js';

export const MSG_LOAD = 'No se pudieron cargar los datos. Inténtalo de nuevo.';
export const MSG_SAVE = 'No se pudo guardar. Inténtalo de nuevo.';
export const MSG_DENIED = 'No tienes permiso para esta operación.';

export function db() {
  const sb = getSupabase();
  if (!sb) throw new Error(MSG_NOT_CONFIGURED);
  return sb;
}

/**
 * Lanza un Error con mensaje para el usuario según el código de Postgres.
 * @param {{ code?: string } | null} error
 * @param {string} fallback
 * @param {Record<string, string>} [byCode] mensajes específicos por código
 */
export function raise(error, fallback, byCode = {}) {
  const code = error?.code;
  if (code && Object.prototype.hasOwnProperty.call(byCode, code)) throw new Error(byCode[code]);
  if (code === '42501') throw new Error(MSG_DENIED);
  throw new Error(fallback);
}
