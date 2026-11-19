// S-04 — Content Security Policy del front. GitHub Pages no permite cabeceras
// propias, así que la política viaja en un <meta http-equiv> que inyecta el
// plugin de vite.config.js en el build. Funciones puras: sin DOM ni Node.
//
// connect-src solo admite el origen propio y el proyecto Supabase de este
// repositorio. Un origen de bucle local (Supabase local en CI o en desarrollo)
// se añade solo si VITE_SUPABASE_URL apunta a él; cualquier otro origen hace
// fallar el build para que la clave publicable y los tokens no viajen a un
// host ajeno por error de configuración.

export const PRODUCTION_SUPABASE_ORIGIN = 'https://oehtspdtpwdhfhhhkgao.supabase.co';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Origen de Supabase permitido para la URL configurada, o error. */
export function supabaseOrigins(supabaseUrl) {
  const origins = [PRODUCTION_SUPABASE_ORIGIN];
  let local = false;
  if (supabaseUrl) {
    let u;
    try {
      u = new URL(supabaseUrl);
    } catch {
      throw new Error(`CSP: VITE_SUPABASE_URL no es una URL válida`);
    }
    if (u.origin === PRODUCTION_SUPABASE_ORIGIN) {
      // ya incluido
    } else if (u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname)) {
      origins.push(u.origin);
      local = true;
    } else {
      throw new Error(`CSP: origen de Supabase no permitido (${u.origin}); solo el proyecto del repo o 127.0.0.1/localhost`);
    }
  }
  return { origins, local };
}

const wsOf = (origin) => origin.replace(/^http/, 'ws');

/** Política CSP como string, lista para el atributo content del <meta>. */
export function buildCsp(supabaseUrl) {
  const { origins, local } = supabaseOrigins(supabaseUrl);
  const connect = ["'self'"];
  for (const o of origins) connect.push(o, wsOf(o));
  const directives = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
  ];
  // En builds locales la app se sirve por http://localhost: no se fuerza https.
  if (!local) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export const REFERRER_POLICY = 'no-referrer';
