// Seguridad (M-13), categorías 3 (entradas) y 6 (código): el tope |v| < 2^53 del motor y del
// front. Se comprueba que:
//  - los mensajes nuevos de "fuera de rango" son fijos: no reflejan la entrada (ni HTML ni
//    prefijos de fórmula) y no empiezan por = + - @;
//  - isSafeMagnitude no se engaña con objetos con valueOf, cadenas, BigInt ni -0;
//  - el importador CSV rechaza filas enormes sin reflejarlas y en tiempo lineal (sin ReDoS);
//  - la BD sigue siendo la barrera real: los CHECK de M-11/M-12 siguen en las migraciones y
//    las pruebas de API que los atacan no están omitidas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isSafeMagnitude, SAFE_ABS_LIMIT, SAFE_ABS_LIMIT_TEXT,
  validateIndicator, validateCommitment, validateMeasurementInput, parseMeasurementsCsv,
} from '../../engine/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const FORMULA = /^[=+\-@\t\r]/;
const XSS = '<img src=x onerror=alert(1)>';
const ctx = { units: [{ id: 'u1', name: 'Unidad A' }], today: '2026-11-20' };

test('SAFE_ABS_LIMIT_TEXT es fijo, sin HTML ni prefijo de fórmula', () => {
  assert.equal(SAFE_ABS_LIMIT, 2 ** 53);
  assert.doesNotMatch(SAFE_ABS_LIMIT_TEXT, /[<>"'`]/);
  assert.doesNotMatch(SAFE_ABS_LIMIT_TEXT, FORMULA);
});

test('isSafeMagnitude solo acepta number primitivo finito (sin coerción)', () => {
  const tricky = [
    { valueOf: () => 1 }, { toString: () => '1' }, '1', ' 1 ', '0x10', [], [1], true, null,
    undefined, 1n, new Number(1), Number.NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 53), 1e308,
  ];
  for (const v of tricky) assert.equal(isSafeMagnitude(v), false, String(typeof v));
  for (const v of [0, -0, 1e-300, 2 ** 53 - 1, -(2 ** 53 - 1), 0.5]) assert.equal(isSafeMagnitude(v), true);
});

test('validateIndicator: mensajes de fuera de rango no reflejan el valor; categoría hostil solo como texto', () => {
  const r = validateIndicator({
    measurementType: 'window_average', direction: 'higher_is_better',
    thresholds: { green: 1e300, yellow: -1e300 },
    thresholdsByCategory: { [XSS]: { green: 2 ** 60, yellow: 1 } },
  });
  assert.equal(r.ok, false);
  const range = r.errors.filter((e) => e.includes('fuera de rango'));
  assert.equal(range.length, 3);
  for (const e of range) {
    assert.doesNotMatch(e, /1e\+?300|1152921504606846976/);
    assert.doesNotMatch(e, FORMULA);
  }
});

test('validateCommitment: overrides y paquetes enormes rechazados sin reflejar el valor', () => {
  const ind = { measurementType: 'cumulative_target', direction: 'higher_is_better' };
  const o = validateCommitment(ind, { period: '2027-Q1', greenOverride: -1e300, yellowOverride: 1e300 });
  assert.equal(o.ok, false);
  for (const e of o.errors) assert.doesNotMatch(e, /1e\+?300|^[=+\-@]/);
  // Suma que desborda a Infinity con valores individualmente seguros: se rechaza el total.
  const pkg = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`C${i}`, 2 ** 53 - 1]));
  const t = validateCommitment(ind, { period: '2027-Q1', packageByCategory: pkg });
  assert.equal(t.ok, false);
  assert.match(t.errors.join(' '), /Paquete total: fuera de rango/);
  // __proto__ como clave: rechazado y sin contaminar el prototipo.
  const p = validateCommitment(ind, { period: '2027-Q1', packageByCategory: JSON.parse('{"__proto__": 1e300}') });
  assert.equal(p.ok, false);
  assert.equal(({}).polluted, undefined);
});

test('validateMeasurementInput: valor enorme -> mensaje fijo sin la entrada', () => {
  for (const measurementType of ['window_average', 'cumulative_target']) {
    const ind = { measurementType, direction: 'higher_is_better' };
    const huge = '9'.repeat(400);
    const r = validateMeasurementInput(ind, { fecha: '2026-11-01', unidad: 'Unidad A', valor: huge }, ctx);
    assert.equal(r.ok, false);
    const msg = r.errors.map((e) => e.message).join(' ');
    assert.match(msg, /valor: fuera de rango/);
    assert.ok(!msg.includes(huge.slice(0, 20)), 'el mensaje no debe reflejar la cifra');
  }
});

test('parseMeasurementsCsv: filas enormes o con fórmula, mensajes sin reflejo peligroso y en tiempo lineal', () => {
  const ind = { measurementType: 'window_average', direction: 'higher_is_better' };
  const long = '1'.repeat(200000) + '.' + '1'.repeat(200000) + 'x'; // cola que no casa (ReDoS)
  const csv = [
    'fecha,unidad,valor',
    '2026-11-01,Unidad A,9007199254740992',
    `2026-11-02,Unidad A,${'9'.repeat(400)}`,
    '2026-11-03,Unidad A,=1e300',
    `2026-11-04,Unidad A,${long}`,
  ].join('\n');
  const t0 = performance.now();
  const r = parseMeasurementsCsv(csv, ind, ctx);
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `parse tardó ${ms} ms`);
  assert.equal(r.rows.length, 0);
  assert.ok(r.errors.length >= 4);
  for (const e of r.errors) {
    assert.doesNotMatch(e.message, FORMULA);
    assert.ok(!e.message.includes('9'.repeat(30)), 'sin reflejo de la cifra fuera de rango');
  }
});

// M-14 reemplaza los CHECK con el mismo nombre (DROP + ADD). La intención se mantiene: la
// barrera nunca desaparece. Se exige que todo DROP de un CHECK `_safe` vaya, en la MISMA
// sentencia ALTER TABLE (atómica), seguido del ADD del mismo nombre; sin `if exists`, sin
// NOT VALID y con la última definición con tope <= 2^53 (estricto).
const SAFE_CHECKS = [
  'indicators_green_threshold_safe', 'indicators_yellow_threshold_safe',
  'commitments_green_override_safe', 'commitments_yellow_override_safe',
  'commitments_package_total_safe', 'commitments_package_by_category_safe',
  'targets_target_value_safe', 'indicators_thresholds_by_category_safe', 'measurements_value_safe',
];
// Comparación decimal exacta (Number() redondearía 9007199254740992.4 a 2^53).
const decimalAtMost2p53 = (txt) => {
  const [ip, fp = ''] = txt.split('.');
  const n = BigInt(ip);
  return n < 2n ** 53n || (n === 2n ** 53n && /^0*$/.test(fp));
};
const stripComments = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

test('la BD sigue siendo la barrera: CHECK de M-11/M-12 presentes y nunca sin reemplazo atómico', () => {
  const dir = join(ROOT, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const all = files.map((f) => stripComments(read(join('supabase/migrations', f)))).join('\n');
  // Sentencias SQL (ninguna migración usa $$ con ';' dentro de un ALTER TABLE de estos CHECK).
  const stmts = all.split(';');
  for (const c of SAFE_CHECKS) {
    assert.match(all, new RegExp(`add constraint ${c}\\b`), c);
    assert.doesNotMatch(all, new RegExp(`drop constraint if exists ${c}\\b`, 'i'), `${c}: sin drop if exists`);
    assert.doesNotMatch(all, new RegExp(`${c}[^;]*not valid`, 'i'), `${c} debe quedar validado`);
    let lastDef = null;
    for (const st of stmts) {
      const drops = st.match(new RegExp(`drop\\s+constraint\\s+${c}\\b`, 'gi')) ?? [];
      const adds = st.match(new RegExp(`add\\s+constraint\\s+${c}\\b`, 'gi')) ?? [];
      if (drops.length) {
        assert.match(st, /^\s*alter\s+table\s/i, `${c}: el DROP debe ir dentro de un ALTER TABLE`);
        assert.equal(adds.length, drops.length, `${c}: cada DROP lleva su ADD en la misma sentencia`);
        assert.ok(st.search(new RegExp(`drop\\s+constraint\\s+${c}\\b`, 'i'))
          < st.search(new RegExp(`add\\s+constraint\\s+${c}\\b`, 'i')), `${c}: el ADD va después del DROP`);
      }
      if (adds.length) {
        const i = st.search(new RegExp(`add\\s+constraint\\s+${c}\\b`, 'i'));
        const rest = st.slice(i);
        const next = rest.slice(1).search(/,\s*(add|drop|alter)\s+constraint\s/i);
        lastDef = next === -1 ? rest : rest.slice(0, next + 1);
      }
    }
    assert.ok(lastDef, `${c}: hay definición final`);
    const caps = lastDef.match(/\d{12,}(\.\d+)?/g) ?? [];
    assert.ok(caps.length >= 1, `${c}: la definición final tiene tope`);
    for (const cap of caps) assert.ok(decimalAtMost2p53(cap), `${c}: tope ${cap} > 2^53`);
    assert.doesNotMatch(lastDef, /<=\s*9007199254740992\b/, `${c}: no admite 2^53`);
  }
  for (const f of ['tests/security/api/numeric-safe-cap-m11.test.js', 'tests/security/api/json-shape-m12.test.js',
    'tests/security/api/safe-cap-m14.test.js']) {
    assert.doesNotMatch(read(f), /\.(skip|todo)\(|\{\s*skip\s*:/, `${f} no debe tener pruebas omitidas`);
  }
});

test('engine/numeric.js es puro: sin red, almacenamiento, eval ni regex', () => {
  const src = read('engine/numeric.js');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|eval\(|new Function|import\(/);
  assert.doesNotMatch(src, /new RegExp|\/[^/\n*]+\/[gimsuy]*\.test/);
  assert.doesNotMatch(src, /sb_secret_|service_role|eyJhbGci/);
});
