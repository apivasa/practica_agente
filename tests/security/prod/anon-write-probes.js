// S-05c (H-QA-S05b-01) — Sondas de escritura anónima de la fase B.
//
// Cada cuerpo usa SOLO columnas reales de la tabla (supabase/migrations) con
// valores del tipo correcto, para que PostgREST no corte la petición con
// `400 PGRST204` (columna inexistente) ni `22P02` (tipo) antes de que
// PostgreSQL compruebe el privilegio INSERT. Así la respuesta esperada es la
// del privilegio: `42501` (401 para anon) y nada más.
//
// No destructivas aunque `anon` tuviera INSERT:
//   - exceptions y user_roles apuntan a ids inexistentes → la FK (23503) impide
//     crear la fila; la prueba fallaría igual (23xxx = llegó a las restricciones).
//   - units y audit_log llevan la marca `s05-fase-b` para localizarlas y
//     borrarlas (procedimiento en docs/seguridad/pentest-preproduccion.md).
//
// `tests/security/anon-write-probes-s05c.test.js` (corre en CI, sin red)
// comprueba que cada columna existe en el esquema y que los enums son válidos.
export const MARK = 's05-fase-b';
export const MISSING_UNIT = '00000000-0000-4000-8000-0000000005e5';
export const MISSING_USER = '00000000-0000-4000-8000-0000000005e6';

export const ANON_WRITE_PROBES = {
  units: { name: MARK },
  exceptions: { unit_id: MISSING_UNIT, scope: 'all', reason: MARK, expires_on: '2099-01-01' },
  audit_log: { actor: MARK, action: MARK, entity: MARK },
  user_roles: { user_id: MISSING_USER, role: 'kpi_manager' },
};

// Valores de enum usados por las sondas: tabla.columna → [tipo, valor].
export const PROBE_ENUMS = {
  'exceptions.scope': ['exception_scope', 'all'],
  'user_roles.role': ['app_role', 'kpi_manager'],
};

// Veredicto estricto de una respuesta de PostgREST a una sonda anónima.
// Devuelve null si es una denegación por privilegio; si no, el motivo.
export function privilegeDenialProblem(status, json) {
  const code = json && typeof json === 'object' ? json.code : undefined;
  if (typeof code === 'string' && code.startsWith('PGRST')) {
    return `PostgREST respondió ${code} antes del chequeo de privilegios (la sonda no prueba nada)`;
  }
  if (typeof code === 'string' && /^2[23]/.test(code)) {
    return `llegó a validar tipos o restricciones (${code}): anon tiene privilegio`;
  }
  if (code === '42501') return [401, 403].includes(status) ? null : `42501 con estado ${status}`;
  // Un 401/403 sin 42501 (p. ej. el gateway rechaza la clave) no demuestra que
  // PostgreSQL deniegue el INSERT: no se acepta.
  return `se esperaba 401/403 con 42501, llegó ${status} ${code ?? ''}`.trim();
}
