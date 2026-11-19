// Sesión: login con correo y contraseña, logout, roles del usuario y cambios
// de sesión. Los mensajes de error no revelan si el correo existe.
import { getSupabase } from './supabase.js';

export const MSG_INVALID = 'Correo o contraseña incorrectos.';
export const MSG_NETWORK = 'No se pudo iniciar sesión. Revisa tu conexión e inténtalo de nuevo.';
export const MSG_NOT_CONFIGURED = 'La aplicación no está configurada para iniciar sesión.';
export const MSG_ROLES = 'No se pudieron cargar tus permisos. Inténtalo de nuevo.';

function requireClient() {
  const sb = getSupabase();
  if (!sb) throw new Error(MSG_NOT_CONFIGURED);
  return sb;
}

/** Inicia sesión. Devuelve { ok: true, session } o { ok: false, message }. */
export async function signIn(email, password) {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: MSG_NOT_CONFIGURED };
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: String(email ?? '').trim(),
      password: String(password ?? ''),
    });
    if (error || !data?.session) {
      // 400/422 (credenciales, correo sin confirmar, usuario inexistente) -> mismo mensaje.
      const status = error?.status ?? 0;
      return { ok: false, message: status >= 500 || status === 0 ? MSG_NETWORK : MSG_INVALID };
    }
    return { ok: true, session: data.session };
  } catch {
    return { ok: false, message: MSG_NETWORK };
  }
}

export async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  // scope 'local': cierra la sesión de este navegador aunque falle la red.
  await sb.auth.signOut({ scope: 'local' });
}

/** Sesión actual (o null). */
export async function getSession() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session ?? null;
}

/**
 * Filas de user_roles del usuario: [{ role, unit_id, indicator_id }].
 * Se filtra por user_id porque gestora y comité pueden leer todas las filas.
 */
export async function getRoles(userId) {
  const sb = requireClient();
  const { data, error } = await sb
    .from('user_roles')
    .select('role, unit_id, indicator_id')
    .eq('user_id', userId);
  if (error) throw new Error(MSG_ROLES);
  return data ?? [];
}

/** Suscribe a cambios de sesión. Devuelve la función para desuscribirse. */
export function onSessionChange(callback) {
  const sb = getSupabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((event, session) => {
    // Diferido: no llamar a Supabase dentro del callback (evita bloqueos de supabase-js).
    setTimeout(() => callback(event, session), 0);
  });
  return () => data?.subscription?.unsubscribe();
}
