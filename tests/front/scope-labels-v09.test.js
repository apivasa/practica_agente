// V-09 (desarrollador): un solo mapa de etiquetas de alcance de excepciones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as logic from '../../src/lib/exceptions-logic.js';
import * as dash from '../../src/lib/dashboard.js';
import { EXCEPTION_SCOPES } from '../../engine/exceptions.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const jsFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  if (statSync(p).isDirectory()) return jsFiles(p);
  return /\.m?js$/.test(name) ? [p] : [];
});

test('tableros y pantalla de excepciones usan el mismo mapa y la misma función', () => {
  assert.equal(dash.SCOPE_LABELS, logic.SCOPE_LABELS);
  assert.equal(dash.scopeLabel, logic.scopeLabel);
  for (const s of EXCEPTION_SCOPES) {
    assert.equal(typeof logic.SCOPE_LABELS[s], 'string');
    assert.equal(dash.scopeLabel(s), logic.SCOPE_LABELS[s]);
  }
  assert.deepEqual(Object.keys(logic.SCOPE_LABELS).sort(), [...EXCEPTION_SCOPES].sort());
});

test('la lista del comité y los tableros muestran la misma etiqueta', () => {
  const row = { id: 'a', unit_id: 'u', scope: 'all', reason: 'r', change_ref: null, expires_on: '2027-01-31', revoked_at: null };
  const [item] = logic.toListItems([row], { today: '2027-01-01', userId: null, units: [] });
  assert.equal(item.scopeLabel, dash.scopeLabel('all'));
});

test('ningún otro archivo de src/ ni engine/ define etiquetas de alcance', () => {
  const offenders = [];
  for (const dir of ['src', 'engine']) {
    for (const file of jsFiles(join(ROOT, dir))) {
      const rel = relative(ROOT, file);
      if (rel === join('src', 'lib', 'exceptions-logic.js')) continue;
      const text = readFileSync(file, 'utf8');
      if (/SCOPE_LABELS\s*=|change_start\s*:\s*['"]/.test(text)) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, []);
});

test('scopeLabel: desconocidos y claves heredadas salen literales', () => {
  for (const k of ['toString', '__proto__', 'constructor', 'x']) assert.equal(logic.scopeLabel(k), k);
  assert.equal(logic.scopeLabel(null), '—');
});
