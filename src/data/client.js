// Acceso común a Supabase para la capa de datos (ADR 0009). Los errores se
// traducen a mensajes en español aptos para mostrar; nunca se expone el error
// crudo de PostgREST.
import { getSupabase } from '../lib/supabase.js';
import { MSG_NOT_CONFIGURED } from '../lib/session.js';
import { readAllPages } from '../lib/paginate.js';

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

/**
 * Todas las filas de una consulta, página a página (H-1 de V-01..V-03: PostgREST corta en
 * max_rows sin error). `build()` debe devolver una consulta nueva con orden total
 * (por ejemplo, terminar en `.order('id')`).
 * @param {() => any} build
 * @param {string} [fallback] mensaje si falla
 */
export function allPages(build, fallback = MSG_LOAD) {
  return readAllPages((from, to) => build().range(from, to), { onError: (error) => raise(error, fallback) });
}
