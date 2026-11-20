// QA V-08/V-09 (tester). Trazas:
// - V-09: "Un solo mapa de etiquetas de alcance de excepciones" (plan-maestro); criterio: prueba unitaria.
// - V-08: "'Inicio autorizado: REF'" en el front; ADR 0003 punto 2 (congelada sigue congelada).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../../src/lib/exceptions-logic.js';
import * as dash from '../../src/lib/dashboard.js';
import { EXCEPTION_SCOPES } from '../../engine/exceptions.js';

// DOM mínimo para renderizar las piezas de los tableros (solo textContent).
function fakeDocument() {
  const make = (tag) => ({
    tag, attrs: {}, children: [], textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {},
    append(c) { this.children.push(c); },
  });
  return { createElement: make, createTextNode: (t) => ({ tag: '#text', textContent: t, children: [] }) };
}
const textOf = (n) => (n ? `${n.textContent ?? ''}${(n.children ?? []).map(textOf).join('')}` : '');
const findAll = (n, pred, out = []) => {
  if (!n) return out;
  if (pred(n)) out.push(n);
  for (const c of n.children ?? []) findAll(c, pred, out);
  return out;
};

let parts;
let prevDoc;
before(async () => {
  prevDoc = globalThis.document;
  globalThis.document = fakeDocument();
  parts = await import('../../src/views/dashboard-parts.js');
});
after(() => { globalThis.document = prevDoc; });

test('V-09: el mapa tiene exactamente los alcances del motor, ni más ni menos', () => {
  assert.deepEqual(Object.keys(logic.SCOPE_LABELS).sort(), [...EXCEPTION_SCOPES].sort());
  for (const s of EXCEPTION_SCOPES) assert.ok(logic.SCOPE_LABELS[s].trim().length > 0, s);
});

test('V-09: tableros y pantalla de excepciones comparten el mismo objeto y la misma función', () => {
  assert.equal(dash.SCOPE_LABELS, logic.SCOPE_LABELS);
  assert.equal(dash.scopeLabel, logic.scopeLabel);
  assert.ok(Object.isFrozen(logic.SCOPE_LABELS));
});

test('V-09: la tabla de excepciones del tablero muestra la misma etiqueta que la pantalla del comité', () => {
  for (const scope of EXCEPTION_SCOPES) {
    const row = { id: `r-${scope}`, unit_id: 'u', scope, reason: 'Ficticia', change_ref: null, expires_on: '2027-01-31', revoked_at: null };
    const [item] = logic.toListItems([row], { today: '2027-01-01', userId: null, units: [] });
    const table = parts.exceptionsTable([row], () => 'Unidad QA');
    const cells = findAll(table, (n) => n.tag === 'td').map(textOf);
    assert.equal(cells[1], item.scopeLabel, scope);
    assert.equal(cells[1], logic.SCOPE_LABELS[scope], scope);
  }
});

test('V-09: las etiquetas antiguas del tablero ya no aparecen', () => {
  const all = Object.values(logic.SCOPE_LABELS);
  assert.ok(!all.includes('Permite iniciar change'));
  assert.ok(!all.includes('Suspende todos los candados'));
});

test('V-08: el bloque "candado hoy" muestra Congelada, sus restricciones y "Inicio autorizado: REF"', () => {
  const lock = dash.unitLockToday({
    unitId: 'u',
    evaluations: [
      { unit_id: 'u', indicator_id: null, month: '2026-10', color: 'red' },
      { unit_id: 'u', indicator_id: null, month: '2026-11', color: 'red' },
    ],
    exceptions: [{ id: 'e1', unit_id: 'u', scope: 'change_start', change_ref: 'CHG-QA-7', expires_on: '2026-12-31', revoked_at: null }],
    today: '2026-12-10',
  });
  const node = parts.lockTodayInfo(lock);
  const text = textOf(node);
  assert.match(text, /Congelada/);
  assert.match(text, /Se frena todo el change/);
  assert.match(text, /Toda la capacidad va al RUN/);
  const starts = findAll(node, (n) => n.attrs?.class === 'authorized-start').map(textOf);
  assert.deepEqual(starts, ['Inicio autorizado: CHG-QA-7']);
});

test('V-08: la referencia del change se muestra como texto (sin HTML)', () => {
  const lock = dash.unitLockToday({
    unitId: 'u',
    evaluations: [
      { unit_id: 'u', indicator_id: null, month: '2026-10', color: 'red' },
      { unit_id: 'u', indicator_id: null, month: '2026-11', color: 'red' },
    ],
    exceptions: [{ id: 'e1', unit_id: 'u', scope: 'change_start', change_ref: '<img src=x onerror=alert(1)>', expires_on: '2026-12-31', revoked_at: null }],
    today: '2026-12-10',
  });
  const node = parts.lockTodayInfo(lock);
  const starts = findAll(node, (n) => n.attrs?.class === 'authorized-start');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].textContent, 'Inicio autorizado: <img src=x onerror=alert(1)>');
  assert.equal(findAll(node, (n) => n.tag === 'img').length, 0);
});

test('V-08: sin cierre vigente el bloque muestra el motivo y ningún nivel', () => {
  const lock = dash.unitLockToday({ unitId: 'u', evaluations: [], exceptions: [], today: '2026-12-10' });
  const text = textOf(parts.lockTodayInfo(lock));
  assert.match(text, /Sin cierre vigente/);
  assert.doesNotMatch(text, /Operación normal|Congelada|Restringida|En excepción/);
});
