// Lógica pura de enrutamiento por rol (sin DOM ni red): la usa router.js y la
// prueban las pruebas unitarias con node:test.

export const LOGIN_PATH = '/login';
export const CHOOSER_PATH = '/inicio';
export const NO_ROLE_PATH = '/sin-rol';

// Orden fijo: define el orden del menú cuando el usuario tiene varios roles.
export const ROLE_ROUTES = Object.freeze({
  kpi_manager: '/gestora',
  custodian: '/custodio',
  committee: '/comite',
  unit_leader: '/lider',
});

export const ROLE_LABELS = Object.freeze({
  kpi_manager: 'Gestora de KPIs',
  custodian: 'Custodio de indicador',
  committee: 'Comité de delivery',
  unit_leader: 'Líder de unidad',
});

const ROLE_ORDER = Object.keys(ROLE_ROUTES);

/** Normaliza el hash de la URL ("#/gestora?x" -> "/gestora"). */
export function parseHash(hash) {
  let path = String(hash ?? '').replace(/^#/, '');
  path = path.split('?')[0].split('#')[0];
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path.toLowerCase();
}

/**
 * Roles distintos y conocidos a partir de las filas de user_roles
 * ({ role, unit_id, indicator_id }). Ignora valores desconocidos.
 */
export function distinctRoles(rows) {
  const present = new Set((rows ?? []).map((r) => r?.role));
  return ROLE_ORDER.filter((role) => present.has(role));
}

/** Rol al que pertenece una ruta, o null si no es ruta de rol. */
export function roleForPath(path) {
  return ROLE_ORDER.find((role) => ROLE_ROUTES[role] === path) ?? null;
}

/** Ruta por defecto de un usuario con sesión según sus roles. */
export function defaultPathFor(roles) {
  if (!roles || roles.length === 0) return NO_ROLE_PATH;
  if (roles.length === 1) return ROLE_ROUTES[roles[0]];
  return CHOOSER_PATH;
}

/**
 * Decide qué vista mostrar.
 * @param {string} path ruta pedida (ya normalizada con parseHash)
 * @param {{ authenticated: boolean, roles: string[] }} state
 * @returns {{ view: string, path: string, redirected: boolean }}
 *   view: 'login' | 'chooser' | 'no-role' | uno de los roles de ROLE_ROUTES
 */
export function resolveRoute(path, { authenticated, roles = [] } = {}) {
  const result = (view, finalPath) => ({ view, path: finalPath, redirected: finalPath !== path });

  if (!authenticated) return result('login', LOGIN_PATH);

  const known = distinctRoles(roles.map((role) => ({ role })));
  const fallback = defaultPathFor(known);

  const role = roleForPath(path);
  if (role && known.includes(role)) return result(role, path);
  if (path === CHOOSER_PATH && known.length > 1) return result('chooser', path);

  // Login, raíz, rutas desconocidas o de otro rol: a la ruta propia.
  if (fallback === NO_ROLE_PATH) return result('no-role', fallback);
  if (fallback === CHOOSER_PATH) return result('chooser', fallback);
  return result(roleForPath(fallback), fallback);
}
