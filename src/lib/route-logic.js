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

/**
 * Registro declarativo de rutas (ADR 0009). La guarda autoriza una ruta si el
 * usuario tiene su `role`. La pantalla de inicio de cada rol usa como `view`
 * la clave del rol; las subrutas, una vista propia que main.js resuelve con
 * VIEWS[view](ctx).
 */
export const ROUTES = Object.freeze([
  { path: '/gestora', role: 'kpi_manager', view: 'kpi_manager', label: 'Inicio' },
  { path: '/gestora/indicadores', role: 'kpi_manager', view: 'kpi-indicators', label: 'Indicadores' },
  { path: '/custodio', role: 'custodian', view: 'custodian', label: 'Inicio' },
  { path: '/custodio/compromisos', role: 'custodian', view: 'custodian-commitments', label: 'Compromisos' },
  { path: '/custodio/mediciones', role: 'custodian', view: 'custodian-measurements', label: 'Mediciones' },
  { path: '/comite', role: 'committee', view: 'committee', label: 'Inicio' },
  { path: '/lider', role: 'unit_leader', view: 'unit_leader', label: 'Inicio' },
].map((r) => Object.freeze(r)));

/** Ruta registrada para un path exacto, o null (sin búsquedas por propiedad). */
export function findRoute(path) {
  return ROUTES.find((r) => r.path === path) ?? null;
}

/** Rutas de un rol, en orden de menú. */
export function routesForRole(role) {
  return ROUTES.filter((r) => r.role === role);
}

/** Rol dueño de una vista registrada, o null. */
export function roleForView(view) {
  return ROUTES.find((r) => r.view === view)?.role ?? null;
}

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

/** Rol al que pertenece una ruta registrada, o null si no es ruta de rol. */
export function roleForPath(path) {
  return findRoute(path)?.role ?? null;
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
 *   view: 'login' | 'chooser' | 'no-role' | la `view` de una ruta de ROUTES
 */
export function resolveRoute(path, { authenticated, roles = [] } = {}) {
  const result = (view, finalPath) => ({ view, path: finalPath, redirected: finalPath !== path });

  if (!authenticated) return result('login', LOGIN_PATH);

  const known = distinctRoles(roles.map((role) => ({ role })));
  const fallback = defaultPathFor(known);

  const route = findRoute(path);
  if (route && known.includes(route.role)) return result(route.view, path);
  if (path === CHOOSER_PATH && known.length > 1) return result('chooser', path);

  // Login, raíz, rutas desconocidas o de otro rol: a la ruta propia.
  if (fallback === NO_ROLE_PATH) return result('no-role', fallback);
  if (fallback === CHOOSER_PATH) return result('chooser', fallback);
  return result(findRoute(fallback).view, fallback);
}
