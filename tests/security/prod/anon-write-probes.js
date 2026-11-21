// S-05c (H-QA-S05b-01, A-1 de S-05c-arquitectura) — Sondas de escritura anónima
// de la fase B.
//
// Cada cuerpo usa SOLO columnas reales de la tabla (supabase/migrations) con
// valores del tipo correcto, para que PostgREST no corte la petición con
// `400 PGRST204` (columna inexistente) ni `22P02` (tipo) antes de que
// PostgreSQL compruebe el privilegio INSERT. Sin privilegio, la respuesta es
// `42501` (permiso denegado) y nada más.
//
// Sin efecto AUNQUE anon tuviera INSERT: cada sonda lleva una violación de
// restricción garantizada (GUARANTEED_VIOLATIONS). El privilegio se comprueba
// antes que las restricciones; si existiera, PostgreSQL respondería 23xxx, la
// sentencia se revierte entera (también los triggers AFTER de auditoría) y no
// queda ninguna fila. La prueba falla igual (23xxx = llegó a las restricciones).
// Importante: audit_log es solo de inserción (trigger audit_log_append_only):
// una fila creada ahí no se podría borrar, por eso ninguna sonda puede prosperar.
//
// `tests/security/anon-write-probes-s05c.test.js` (corre en CI, sin red)
// comprueba contra el esquema que cada columna existe, que los enums son
// válidos y que cada violación garantizada se cumple de verdad.
export const MARK = 's05-fase-b';
export const MISSING_UNIT = '00000000-0000-4000-8000-0000000005e5';
export const MISSING_USER = '00000000-0000-4000-8000-0000000005e6';

export const ANON_WRITE_PROBES = {
  // name solo con espacios: CHECK length(trim(name)) > 0 → 23514.
  units: { name: '   ' },
  // FK a unidad inexistente → 23503; reason en blanco: CHECK → 23514.
  exceptions: { unit_id: MISSING_UNIT, scope: 'all', reason: '   ', expires_on: '2099-01-01' },
  // actor NOT NULL a null → 23502 (sin default ni trigger BEFORE INSERT).
  audit_log: { actor: null, action: MARK, entity: MARK },
  // FK a usuario inexistente → 23503; unit_leader sin unit_id: CHECK user_roles_scope → 23514.
  user_roles: { user_id: MISSING_USER, role: 'unit_leader' },
};

// Violaciones que garantizan que la sonda no crea filas: tabla → [{ kind, column, ... }].
export const GUARANTEED_VIOLATIONS = {
  units: [{ kind: 'blank_check', column: 'name' }],
  exceptions: [
    { kind: 'missing_fk', column: 'unit_id', references: 'public.units' },
    { kind: 'blank_check', column: 'reason' },
  ],
  audit_log: [{ kind: 'not_null', column: 'actor' }],
  user_roles: [
    { kind: 'missing_fk', column: 'user_id', references: 'auth.users' },
    { kind: 'scope_check', column: 'role', constraint: 'user_roles_scope' },
  ],
};

// Valores de enum usados por las sondas: tabla.columna → [tipo, valor].
export const PROBE_ENUMS = {
  'exceptions.scope': ['exception_scope', 'all'],
  'user_roles.role': ['app_role', 'unit_leader'],
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
  if (code === '42501') {
    if (![401, 403].includes(status)) return `42501 con estado ${status}`;
    // H-QA-S05c-02: 42501 también lo da RLS; aquí se exige la falta de GRANT.
    if (!/permission denied/i.test(json.message ?? '')) return `42501 sin «permission denied» (¿RLS en vez de falta de GRANT?): ${json.message}`;
    return null;
  }
  // Un 401/403 sin 42501 (p. ej. el gateway rechaza la clave) no demuestra que
  // PostgreSQL deniegue el INSERT: no se acepta.
  return `se esperaba 401/403 con 42501, llegó ${status} ${code ?? ''}`.trim();
}
