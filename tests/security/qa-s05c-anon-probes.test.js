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
