// Configuración del backend desde variables de entorno. Nunca devuelve ni imprime la clave
// en mensajes de error.

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ url: string, secretKey: string }}
 */
export function readConfig(env) {
  const url = (env.SUPABASE_URL ?? '').trim();
  const secretKey = (env.SUPABASE_SECRET_KEY ?? '').trim();
  const missing = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!secretKey) missing.push('SUPABASE_SECRET_KEY');
  if (missing.length > 0) throw new Error(`faltan variables de entorno: ${missing.join(', ')}`);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('SUPABASE_URL no es una URL válida');
  }
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('SUPABASE_URL debe usar https (http solo para Supabase local)');
  }
  // Solo claves nuevas (CLAUDE.md §4): sin claves legadas anon/service_role (JWT).
  if (!secretKey.startsWith('sb_secret_')) {
    throw new Error('SUPABASE_SECRET_KEY debe ser una clave secreta nueva (prefijo sb_secret_)');
  }
  return { url, secretKey };
}
