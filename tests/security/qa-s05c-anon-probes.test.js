// QA S-05c — Revisión independiente del veredicto estricto de las sondas de
// escritura anónima (H-QA-S05b-01). Traza a: «solo vale 401/403 con 42501» y
// a que el criterio no rechace la respuesta real de PostgREST 12/13 para un
// INSERT sin privilegio.
// PostgREST mapea 42501 a 401 si la petición no trae JWT y a 403 si lo trae.
// Con las claves nuevas de Supabase el gateway puede añadir un JWT anon, así
// que ambos estados son legítimos. Cuerpo real: {code, details, hint, message}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANON_WRITE_PROBES, privilegeDenialProblem } from './prod/anon-write-probes.js';

const realBody = (table) => ({
  code: '42501', details: null, hint: null, message: `permission denied for table ${table}`,
});

test('QA: el cuerpo real de PostgREST (42501 con details/hint null) pasa con 401 y con 403', () => {
  for (const t of Object.keys(ANON_WRITE_PROBES)) {
    assert.equal(privilegeDenialProblem(401, realBody(t)), null, `401 ${t}`);
    assert.equal(privilegeDenialProblem(403, realBody(t)), null, `403 ${t}`);
  }
});

test('QA: 42501 por esquema sin USAGE también es denegación por privilegio', () => {
  const body = { code: '42501', details: null, hint: null, message: 'permission denied for schema public' };
  assert.equal(privilegeDenialProblem(401, body), null);
});

test('QA: respuestas que no prueban el privilegio se rechazan', () => {
  // Tabla fuera de la caché del esquema: PostgREST corta antes de PostgreSQL.
  assert.notEqual(privilegeDenialProblem(404, { code: 'PGRST205', message: 'Could not find the table' }), null);
  // Clave rechazada por el gateway (sin cuerpo PostgREST).
  assert.notEqual(privilegeDenialProblem(401, { message: 'Invalid API key' }), null);
  // Cuerpo no JSON.
  assert.notEqual(privilegeDenialProblem(403, null), null);
  // Unicidad: llegó a las restricciones (anon tendría INSERT).
  assert.notEqual(privilegeDenialProblem(409, { code: '23505' }), null);
  // 42501 con estado inesperado (p. ej. proxy que reescribe a 500).
  assert.notEqual(privilegeDenialProblem(500, realBody('units')), null);
  // Escritura aceptada.
  assert.notEqual(privilegeDenialProblem(201, { code: undefined }), null);
});

test('QA: las sondas no fijan columnas generadas ni de autoría (id, created_at, approved_by)', () => {
  // Diseño de la sonda: valores mínimos; nada que suplante identidad o fechas.
  for (const [t, body] of Object.entries(ANON_WRITE_PROBES)) {
    for (const c of ['id', 'created_at', 'approved_by', 'revoked_by', 'leader_user_id']) {
      assert.ok(!(c in body), `${t}.${c} no debería ir en la sonda`);
    }
  }
});

// --- Intento 2 (A-1 de S-05c-arquitectura, H-QA-S05c-02) --------------------
// Traza a: «aunque anon tuviera INSERT, cada sonda respondería 23xxx y la prueba
// falla» y «solo vale 42501 por falta de GRANT, no por RLS».
test('QA: el código que daría cada violación garantizada se rechaza (anon con privilegio)', () => {
  // units/exceptions: CHECK en blanco → 23514; exceptions/user_roles: FK → 23503;
  // audit_log: NOT NULL → 23502. PostgREST: 400 (23502/23514) o 409 (23503).
  const expected = { units: ['23514'], exceptions: ['23503', '23514'], audit_log: ['23502'], user_roles: ['23503', '23514'] };
  for (const [t, codes] of Object.entries(expected)) {
    assert.ok(t in ANON_WRITE_PROBES, t);
    for (const code of codes) {
      for (const status of [400, 403, 409]) {
        assert.notEqual(privilegeDenialProblem(status, { code, details: null, hint: null, message: 'violates' }), null, `${t} ${status} ${code}`);
      }
    }
  }
});

test('QA: 42501 de RLS (GRANT presente sin política) no cuenta como falta de privilegio', () => {
  // Texto real de PostgreSQL cuando hay INSERT pero falla el WITH CHECK de RLS.
  for (const t of Object.keys(ANON_WRITE_PROBES)) {
    const rls = { code: '42501', details: null, hint: null, message: `new row violates row-level security policy for table "${t}"` };
    assert.notEqual(privilegeDenialProblem(401, rls), null, `401 ${t}`);
    assert.notEqual(privilegeDenialProblem(403, rls), null, `403 ${t}`);
  }
  // 42501 sin mensaje: no se puede distinguir; se rechaza.
  assert.notEqual(privilegeDenialProblem(401, { code: '42501', details: null, hint: null }), null);
  assert.notEqual(privilegeDenialProblem(403, { code: '42501', message: null }), null);
});
