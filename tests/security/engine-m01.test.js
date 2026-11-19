// M-01 — Pruebas de seguridad del motor de color (engine/).
// Categorías: 3 (inyección y entradas), 6 (código: sin eval/red/secretos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  validateIndicator,
  normalizeIndicator,
  measure,
  evaluateColor,
  parseDay,
} from '../../engine/index.js';

const ENGINE_DIR = fileURLToPath(new URL('../../engine/', import.meta.url));
const COLORS = new Set(['green', 'yellow', 'red', 'not_evaluated']);

const base = Object.freeze({
  measurementType: 'window_average',
  direction: 'higher_is_better',
  thresholds: { green: 90, yellow: 80 },
  minSample: 0,
});

const assertNoGlobalPollution = () => {
  const probe = {};
  for (const k of ['green', 'yellow', 'polluted', 'isAdmin']) {
    assert.equal(probe[k], undefined, `Object.prototype contaminado con "${k}"`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'green'), false);
};

// ---------- Categoría 3: prototype pollution ----------

test('3 · __proto__ en thresholdsByCategory (vía JSON.parse) no contamina Object.prototype', () => {
  const cfg = JSON.parse(
    '{"measurementType":"window_average","direction":"higher_is_better",' +
      '"thresholds":{"green":90,"yellow":80},' +
      '"thresholdsByCategory":{"__proto__":{"green":1,"yellow":0,"polluted":true}}}',
  );
  assert.equal(validateIndicator(cfg).ok, true);
  const n = normalizeIndicator(cfg);
  assert.equal(Object.prototype.hasOwnProperty.call(n.thresholdsByCategory, '__proto__'), false);
  evaluateColor(cfg, { value: 10, sampleSize: 1 }, { category: '__proto__' });
  measure(cfg, [{ date: '2026-11-01', value: 1, category: '__proto__' }], { asOf: '2026-11-30' });
  assertNoGlobalPollution();
});

test('3 · constructor/prototype como categoría no contaminan ni rompen', () => {
  const cfg = JSON.parse(
    '{"measurementType":"window_average","direction":"higher_is_better",' +
      '"thresholds":{"green":90,"yellow":80},' +
      '"thresholdsByCategory":{"constructor":{"green":1,"yellow":0},"prototype":{"green":2,"yellow":1}}}',
  );
  const r = evaluateColor(cfg, { value: 1, sampleSize: 1 }, { category: 'constructor' });
  assert.equal(r.color, 'green');
  assertNoGlobalPollution();
  assert.equal(typeof Object.prototype.constructor, 'function');
});

test('3 · categoría heredada (toString, hasOwnProperty, __proto__) sin umbral propio usa umbrales generales', () => {
  for (const category of ['toString', 'hasOwnProperty', '__proto__', 'valueOf', 'constructor']) {
    const r = evaluateColor(base, { value: 85, sampleSize: 1 }, { category });
    assert.equal(r.color, 'yellow', `categoría ${category}`);
    assert.doesNotMatch(r.reason, /categoría/);
  }
});

test('3 · una categoría heredada por prototipo no se usa como umbral propio', () => {
  const cfg = { ...base, thresholdsByCategory: Object.create({ X: { green: 1, yellow: 0 } }) };
  cfg.thresholdsByCategory.Y = { green: 50, yellow: 40 };
  const r = evaluateColor(cfg, { value: 10, sampleSize: 1 }, { category: 'X' });
  assert.equal(r.color, 'red'); // X es heredada: se ignora
  assert.equal(Object.keys(normalizeIndicator(cfg).thresholdsByCategory).join(), 'Y');
});

test('3 · normalizeIndicator devuelve copias: mutar la salida no altera la entrada', () => {
  const cfg = { ...base, thresholds: { green: 90, yellow: 80 }, thresholdsByCategory: { A: { green: 5, yellow: 1 } } };
  const n = normalizeIndicator(cfg);
  n.thresholds.green = -1;
  n.thresholdsByCategory.A.green = -1;
  assert.equal(cfg.thresholds.green, 90);
  assert.equal(cfg.thresholdsByCategory.A.green, 5);
});

// ---------- Categoría 3: números no finitos y tipos ----------

test('3 · umbrales NaN/Infinity/strings/booleanos se rechazan', () => {
  for (const bad of [NaN, Infinity, -Infinity, '90', true, null, {}, [], 1n]) {
    const r = validateIndicator({ ...base, thresholds: { green: bad, yellow: 0 } });
    assert.equal(r.ok, false, `green=${String(bad)}`);
  }
  for (const bad of [NaN, Infinity, '1']) {
    const r = validateIndicator({ ...base, thresholdsByCategory: { A: { green: 1, yellow: bad } } });
    assert.equal(r.ok, false);
  }
});

test('3 · measured.value NaN/Infinity/string lanza error sin evaluar color', () => {
  for (const bad of [NaN, Infinity, -Infinity, '95', {}, true]) {
    assert.throws(() => evaluateColor(base, { value: bad, sampleSize: 10 }), /número finito/);
  }
});

test('3 · mediciones con value NaN/Infinity/string se ignoran en el promedio', () => {
  const rows = [
    { date: '2026-11-01', value: NaN },
    { date: '2026-11-02', value: Infinity },
    { date: '2026-11-03', value: '1e9' },
    { date: '2026-11-04', value: { valueOf: () => 1e9 } },
    { date: '2026-11-05', value: 50 },
  ];
  assert.deepEqual(measure(base, rows, { asOf: '2026-11-30' }), { value: 50, sampleSize: 1 });
});

test('3 · target NaN/Infinity/negativo/string se rechaza', () => {
  const cfg = { ...base, measurementType: 'cumulative_target' };
  const rows = [{ date: '2026-11-01', value: 1 }];
  for (const target of [NaN, Infinity, -1, '10']) {
    assert.throws(() => measure(cfg, rows, { asOf: '2026-11-30', target }), /target/);
  }
});

test('3 · windowDays/minSample no enteros o negativos se rechazan', () => {
  for (const windowDays of [0, -1, 1.5, NaN, Infinity, '30']) {
    assert.equal(validateIndicator({ ...base, windowDays }).ok, false, `windowDays=${windowDays}`);
  }
  for (const minSample of [-1, 0.5, NaN, Infinity, '3']) {
    assert.equal(validateIndicator({ ...base, minSample }).ok, false, `minSample=${minSample}`);
  }
});

test('3 · coverage: compliant solo cuenta con === true (no "true", 1, objetos)', () => {
  const cfg = { ...base, measurementType: 'coverage' };
  const rows = [
    { date: '2026-11-01', appId: 'a', compliant: 'true' },
    { date: '2026-11-01', appId: 'b', compliant: 1 },
    { date: '2026-11-01', appId: 'c', compliant: {} },
    { date: '2026-11-01', appId: 'd', compliant: true },
  ];
  assert.deepEqual(measure(cfg, rows, { asOf: '2026-11-30' }), { value: 25, sampleSize: 4 });
});

test('3 · coverage: appId "__proto__"/"constructor" se cuentan como apps normales (Map, sin contaminación)', () => {
  const cfg = { ...base, measurementType: 'coverage' };
  const rows = [
    { date: '2026-11-01', appId: '__proto__', compliant: true },
    { date: '2026-11-01', appId: 'constructor', compliant: false },
  ];
  assert.deepEqual(measure(cfg, rows, { asOf: '2026-11-30' }), { value: 50, sampleSize: 2 });
  assertNoGlobalPollution();
});

// ---------- Categoría 3: fechas raras ----------

test('3 · parseDay rechaza fechas inválidas, con hora, con espacios o con caracteres extra', () => {
  const bad = [
    '2026-02-30', '2026-13-01', '2026-00-10', '2026-11-31', '2026-11-1',
    '2026-11-01T00:00:00Z', ' 2026-11-01', '2026-11-01 ', '2026-11-01\n', '٢026-11-01',
    '+02026-11-01', '-2026-11-01', '0000-01-01', '0099-12-31', '2026/11/01', '',
    20261101, null, undefined, {}, ['2026-11-01'], new Date('2026-11-01'),
  ];
  for (const s of bad) assert.equal(parseDay(s), null, `debería rechazar ${JSON.stringify(String(s))}`);
  assert.equal(parseDay('2024-02-29') !== null, true);
});

test('3 · asOf inválido lanza error genérico sin reflejar el valor recibido', () => {
  const payload = '<script>alert(1)</script>';
  assert.throws(
    () => measure(base, [], { asOf: payload }),
    (e) => e instanceof Error && !e.message.includes(payload),
  );
  assert.throws(() => measure(base, [], undefined), /asOf/);
  assert.throws(() => measure(base, 'not-an-array', { asOf: '2026-11-30' }), /arreglo/);
});

test('3 · mediciones con fecha inválida o fuera de ventana no cuentan (no se pueden colar datos de otro periodo)', () => {
  const rows = [
    { date: '2026-10-31', value: 0 }, // fuera (ventana 30 días hasta 2026-11-30)
    { date: '2026-12-01', value: 0 }, // futuro
    { date: '2026-11-31', value: 0 }, // inexistente
    { date: '2026-11-15T00:00', value: 0 },
    { date: '2026-11-15', value: 100 },
  ];
  assert.deepEqual(measure(base, rows, { asOf: '2026-11-30' }), { value: 100, sampleSize: 1 });
});

test('3 · elementos no objeto en el arreglo (null, números, strings) se ignoran sin lanzar', () => {
  const rows = [null, undefined, 1, 'x', true, [], { date: '2026-11-10', value: 90 }];
  assert.deepEqual(measure(base, rows, { asOf: '2026-11-30' }), { value: 90, sampleSize: 1 });
});

// ---------- Categoría 3: complejidad / tamaño ----------

test('3 · 200 000 mediciones se procesan en tiempo lineal (< 2 s) en los tres tipos', () => {
  const N = 200_000;
  const rows = Array.from({ length: N }, (_, i) => ({
    date: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
    value: i % 100,
    appId: `app-${i % 5000}`,
    compliant: i % 2 === 0,
  }));
  for (const measurementType of ['window_average', 'coverage', 'cumulative_target']) {
    const t0 = performance.now();
    const r = measure({ ...base, measurementType }, rows, { asOf: '2026-11-30', target: 1000 });
    const ms = performance.now() - t0;
    assert.ok(ms < 2000, `${measurementType} tardó ${ms.toFixed(0)} ms`);
    assert.ok(Number.isFinite(r.value));
  }
});

test('3 · windowDays enorme no itera por días ni acepta años < 100', () => {
  const cfg = { ...base, windowDays: Number.MAX_SAFE_INTEGER };
  const t0 = performance.now();
  const r = measure(cfg, [{ date: '0001-01-01', value: 1 }, { date: '1970-01-01', value: 50 }], { asOf: '2026-11-30' });
  assert.ok(performance.now() - t0 < 100);
  assert.deepEqual(r, { value: 50, sampleSize: 1 });
});

test('3 · validación con miles de categorías termina rápido', () => {
  const byCat = {};
  for (let i = 0; i < 20_000; i++) byCat[`c${i}`] = { green: 10, yellow: 5 };
  const t0 = performance.now();
  assert.equal(validateIndicator({ ...base, thresholdsByCategory: byCat }).ok, true);
  assert.ok(performance.now() - t0 < 1000);
});

test('3 · la salida de evaluateColor siempre es uno de los 4 colores', () => {
  const values = [null, -1e300, -1, 0, 79.999, 80, 89.999, 90, 1e300];
  for (const direction of ['higher_is_better', 'lower_is_better']) {
    for (const value of values) {
      const r = evaluateColor({ ...base, direction, thresholds: direction === 'higher_is_better' ? { green: 90, yellow: 80 } : { green: 80, yellow: 90 } }, { value, sampleSize: 5 });
      assert.ok(COLORS.has(r.color));
      assert.equal(typeof r.reason, 'string');
    }
  }
});

test('3 · configuraciones no objeto (null, arreglos, strings) se rechazan sin lanzar TypeError', () => {
  for (const cfg of [null, undefined, [], 'cfg', 42, true]) {
    const r = validateIndicator(cfg);
    assert.equal(r.ok, false);
    assert.throws(() => normalizeIndicator(cfg), /Indicador inválido/);
  }
});

// ---------- Categoría 6: código del motor ----------

const engineSources = () =>
  readdirSync(ENGINE_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({
      f,
      // Se quitan comentarios (JSDoc usa import('./x.js') como tipo, no es código).
      src: readFileSync(join(ENGINE_DIR, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    }));

test('6 · el motor no usa eval, Function, RegExp dinámicas ni import dinámico', () => {
  for (const { f, src } of engineSources()) {
    assert.doesNotMatch(src, /\beval\s*\(/, `${f}: eval`);
    assert.doesNotMatch(src, /\bnew\s+Function\b|\bFunction\s*\(/, `${f}: Function`);
    assert.doesNotMatch(src, /\bnew\s+RegExp\b|\bRegExp\s*\(/, `${f}: RegExp dinámica`);
    assert.doesNotMatch(src, /\bimport\s*\(/, `${f}: import dinámico`);
    assert.doesNotMatch(src, /\bsetTimeout\s*\(\s*['"`]|\bsetInterval\s*\(\s*['"`]/, `${f}: timer con string`);
  }
});

test('6 · el motor es puro: sin red, sistema de archivos, entorno ni DOM', () => {
  for (const { f, src } of engineSources()) {
    assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|WebSocket/, `${f}: red`);
    assert.doesNotMatch(src, /\bprocess\.|\brequire\s*\(|from\s+['"]node:/, `${f}: entorno/node`);
    assert.doesNotMatch(src, /\bdocument\.|\bwindow\.|innerHTML|localStorage/, `${f}: DOM`);
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of imports) assert.match(spec, /^\.\//, `${f}: importa ${spec} fuera del motor`);
  }
});

test('6 · el motor no contiene secretos ni claves', () => {
  for (const { f, src } of engineSources()) {
    assert.doesNotMatch(src, /sb_secret_|sb_publishable_|service_role|eyJ[A-Za-z0-9_-]{10,}\.|-----BEGIN [A-Z ]*PRIVATE KEY/, f);
  }
});

test('6 · la regex de fechas es anclada y sin cuantificadores anidados (sin ReDoS)', () => {
  const evil = '1'.repeat(100_000) + '-';
  const t0 = performance.now();
  assert.equal(parseDay(evil), null);
  assert.ok(performance.now() - t0 < 50);
});
