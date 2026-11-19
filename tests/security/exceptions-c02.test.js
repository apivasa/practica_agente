// C-02 — Seguridad de las excepciones del comité sin dependencias (node:test).
// Categorías 1 (autorización en el front y en la automatización), 3 (XSS)
// y 5 (las Actions no quitan candados indebidamente).
//
// La autorización real (trigger + RLS) se prueba contra Supabase local en
// tests/security/api/exceptions-c02.test.js y en
// supabase/tests/security/044_security_exceptions_c02.test.sql.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { toListItems } from '../../src/lib/exceptions-logic.js';
import { evaluateUnitMonth } from '../../scripts/lib/build.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ME = '11111111-1111-4111-8111-000000000004';
const OTHER = '11111111-1111-4111-8111-000000000001';
const UNITS = [{ id: 'u-alfa', name: '<b>Alfa</b>' }];
const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
const row = (over = {}) => ({
  id: 'e1', unit_id: 'u-alfa', scope: 'all', reason: XSS, change_ref: null,
  expires_on: '2026-12-31', approved_by: ME, created_at: '2026-11-19T15:00:00Z', revoked_at: null, ...over,
});

describe('C-02 · XSS en la vista de excepciones (categoría 3)', () => {
  const view = strip(read('src/views/committee/exceptions.js'));

  test('la vista no usa sinks HTML', () => {
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'DOMParser', 'createContextualFragment', 'srcdoc']) {
      assert.ok(!view.includes(sink), `sink ${sink} en la vista de excepciones`);
    }
  });

  test('motivo, change y unidad se pintan como texto (el() con text)', () => {
    for (const field of ['it.reason', 'it.changeRef', 'it.unitName']) {
      assert.match(view, new RegExp(`text:\\s*${field.replace('.', '\\.')}`), `${field} no va por text`);
    }
  });

  test('toListItems no altera ni interpreta el HTML del motivo, la unidad ni el change', () => {
    const [it] = toListItems([row({ scope: 'change_start', change_ref: '"><svg onload=alert(3)>' })], { today: '2026-11-20', userId: ME, units: UNITS });
    assert.equal(it.reason, XSS);
    assert.equal(it.changeRef, '"><svg onload=alert(3)>');
    assert.equal(it.unitName, '<b>Alfa</b>');
  });
});

describe('C-02 · botón Revocar (categoría 1, defensa en profundidad)', () => {
  const opts = { today: '2026-11-20', units: UNITS };
  test('solo quien aprobó, y solo si está vigente', () => {
    assert.equal(toListItems([row()], { ...opts, userId: ME })[0].canRevoke, true);
    assert.equal(toListItems([row({ approved_by: OTHER })], { ...opts, userId: ME })[0].canRevoke, false);
    assert.equal(toListItems([row({ approved_by: null })], { ...opts, userId: null })[0].canRevoke, false, 'null === null no habilita revocar');
    assert.equal(toListItems([row({ revoked_at: '2026-11-19T20:00:00Z' })], { ...opts, userId: ME })[0].canRevoke, false);
    assert.equal(toListItems([row({ expires_on: '2026-11-01' })], { ...opts, userId: ME })[0].canRevoke, false);
  });

  test('la capa de datos no envía campos de servidor', () => {
    const src = strip(read('src/data/exceptions.js'));
    const insert = src.slice(src.indexOf('.insert('), src.indexOf('export', src.indexOf('.insert(')));
    for (const f of ['approved_by', 'created_at', 'revoked_at', 'revoked_by']) {
      assert.ok(!new RegExp(`\\b${f}\\s*:`).test(insert), `createException envía ${f}`);
    }
    const upd = src.slice(src.indexOf('.update('), src.indexOf('.update(') + 200);
    assert.match(upd, /\.update\(\{\s*revoked_at:[^,}]+\}\)/, 'revokeException debe enviar solo revoked_at');
  });
});

// ---------------------------------------------------------------------------
// H-C02-01 (Alta): la evaluación programada (C-03) es la que escribe los
// candados en evaluations. Si ignora revoked_at, revocar no devuelve el
// candado: la excepción revocada sigue suspendiendo restricciones hasta su
// vencimiento (hasta 90 días). Categoría 5: "quitar candados indebidamente".
// ---------------------------------------------------------------------------
describe('C-02 · la automatización respeta la revocación (categoría 5)', () => {
  test('scripts/lib/db.js lee revoked_at (y change_ref) de exceptions', () => {
    const src = strip(read('scripts/lib/db.js'));
    const i = src.indexOf(".from('exceptions')");
    assert.ok(i >= 0, 'no se encontró la consulta de exceptions');
    const sel = src.slice(i, i + 300).match(/\.select\('([^']+)'\)/);
    assert.ok(sel, 'consulta de exceptions sin select explícito');
    const cols = sel[1].split(',').map((c) => c.trim());
    assert.ok(cols.includes('revoked_at'), `exceptions se lee sin revoked_at: ${sel[1]}`);
    assert.ok(cols.includes('change_ref'), `exceptions se lee sin change_ref: ${sel[1]}`);
  });

  test('una excepción revocada no suspende el congelamiento en la evaluación mensual', () => {
    const base = { evalMonth: '2026-11', asOf: '2026-12-01', indicatorColors: ['red'], storedColors: { '2026-10': 'red' } };
    const revoked = { id: 'e-rev', unit_id: 'u', scope: 'all', change_ref: null, expires_on: '2026-12-31', revoked_at: '2026-11-20T15:00:00Z' };
    const without = evaluateUnitMonth({ ...base, exceptions: [] }).escalation;
    const withRevoked = evaluateUnitMonth({ ...base, exceptions: [revoked] }).escalation;
    assert.equal(without.level, 'frozen');
    assert.deepEqual(withRevoked.appliedExceptions, [], 'la excepción revocada se aplicó');
    assert.equal(withRevoked.level, without.level, 'la excepción revocada levantó el candado');
    assert.deepEqual(withRevoked.restrictions, without.restrictions);
  });

  test('revoked_at se pasa al motor como fecha de America/Guayaquil', () => {
    // 2026-12-01T03:00Z es todavía 30 de noviembre en Guayaquil (UTC-5):
    // revocada el 30 → no aplica el 1 de diciembre.
    const base = { evalMonth: '2026-11', asOf: '2026-12-01', indicatorColors: ['red'], storedColors: { '2026-10': 'red' } };
    const revoked = { id: 'e-rev2', unit_id: 'u', scope: 'all', change_ref: null, expires_on: '2026-12-31', revoked_at: '2026-12-01T03:00:00Z' };
    const r = evaluateUnitMonth({ ...base, exceptions: [revoked] }).escalation;
    assert.deepEqual(r.appliedExceptions, []);
    assert.deepEqual(r.revokedExceptions, ['e-rev2']);
  });
});
