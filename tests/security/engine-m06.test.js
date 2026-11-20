// M-06 — Pruebas de seguridad del color mensual por criticidad (engine/vulnerabilities.js
// categoryMonthColor, engine/rows.js evaluateCategoryMonth) y de su uso en la vista del líder.
// Categorías: 3 (entradas: jsonb de categorías/paquete, claves de prototipo, NaN/Infinity,
// negativos, XSS en etiquetas), 5 (automatizaciones: datos manipulados no dan verde ni
// rompen la evaluación), 6 (código: sin innerHTML/eval), 8 (semilla ficticia).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateCategoryMonth, hasCategoryEvaluation, categoryMonthColor, packageStatus } from '../../engine/index.js';
import { categoryGoal } from '../../src/lib/dashboard.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

// Fila de `indicators` como la devuelve PostgREST (JSON.parse: '__proto__' queda como clave propia).
const indicatorRow = (tbcJson = '{"P0P1":{"green":96,"yellow":90},"P2P3":{"green":85,"yellow":75}}') => ({
  id: 'ind-vuln',
  measurement_type: 'cumulative_target',
  direction: 'higher_is_better',
  window_days: 30,
  green_threshold: 96,
  yellow_threshold: 90,
  min_sample: 1,
  frequency: 'monthly',
  source: 'manual',
  thresholds_by_category: JSON.parse(tbcJson),
});
const commitment = (pkg = { P0P1: 1000, P2P3: 500 }) => ({ period: '2027-Q1', package_by_category: pkg });
const row = (value, category, kind = 'resolved', measured_on = '2027-01-31') => ({ measured_on, value, category, kind });
// Rojo en P0/P1 (100 de 334), verde en P2/P3 (200 de 167).
const redRows = () => [row(100, 'P0P1'), row(200, 'P2P3')];
const run = (over = {}) =>
  evaluateCategoryMonth({ indicator: indicatorRow(), commitment: commitment(), measurements: redRows(), month: '2027-01', ...over });

const protoClean = () => {
  assert.equal(Object.prototype.P0P1, undefined);
  assert.equal(Object.prototype.green, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal({}.color, undefined);
};

test('base: el caso de referencia es rojo (control de las demás pruebas)', () => {
  assert.equal(run().color, 'red');
});

// ---------- Categoría 3: claves de prototipo en jsonb ----------

test('cat 3: "__proto__" en thresholds_by_category no contamina Object.prototype ni da verde', () => {
  for (const json of [
    '{"__proto__":{"green":0,"yellow":0,"polluted":1},"P0P1":{"green":96,"yellow":90},"P2P3":{"green":85,"yellow":75}}',
    '{"__proto__":{"green":0,"yellow":0}}',
  ]) {
    const r = evaluateCategoryMonth({ indicator: indicatorRow(json), commitment: commitment(), measurements: redRows(), month: '2027-01' });
    assert.notEqual(r.color, 'green', json);
    protoClean();
  }
});

test('cat 3: "constructor", "toString", "hasOwnProperty" como categorías quedan sin evaluar y no rompen', () => {
  for (const k of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const json = `{"${k}":{"green":0,"yellow":0},"P0P1":{"green":96,"yellow":90},"P2P3":{"green":85,"yellow":75}}`;
    const r = evaluateCategoryMonth({ indicator: indicatorRow(json), commitment: commitment(), measurements: redRows(), month: '2027-01' });
    assert.equal(r.color, 'red', k);
    assert.equal(r.byCategory[k].color, 'not_evaluated', k);
    const only = evaluateCategoryMonth({
      indicator: indicatorRow(`{"${k}":{"green":0,"yellow":0}}`), commitment: commitment(), measurements: redRows(), month: '2027-01',
    });
    assert.equal(only.color, 'not_evaluated', k);
    protoClean();
  }
});

test('cat 3: "__proto__" / "constructor" en package_by_category no cuentan como paquete', () => {
  for (const json of ['{"__proto__":{"P0P1":1},"P2P3":500}', '{"constructor":5,"P2P3":500}']) {
    const r = run({ commitment: commitment(JSON.parse(json)) });
    assert.notEqual(r.color, 'green', json);
    assert.equal(r.byCategory.P0P1.color, 'not_evaluated', json);
    protoClean();
  }
});

test('cat 3: categoría "__proto__"/"constructor" en una medición no contamina ni da verde', () => {
  for (const c of ['__proto__', 'constructor', 'toString']) {
    const r = run({ measurements: [...redRows(), row(5000, c)] });
    assert.notEqual(r.color, 'green', c);
    protoClean();
  }
});

// ---------- Categorías 3 y 5: cifras manipuladas no pueden producir verde ----------

test('cat 3/5: paquete negativo, decimal, NaN, Infinity, texto o enorme nunca da verde', () => {
  // [], false, '' y ' ' no están: num() los convierte en 0 (paquete vacío → 100 %), ver
  // H-M06-02 en docs/seguridad/hallazgos.md. Un 0 legítimo da el mismo color, así que no hay
  // ganancia sobre lo que el custodio ya puede escribir.
  const bad = [-1, -1000, 1.5, 'NaN', 'Infinity', '1e400', 'abc', {}, Number.MAX_SAFE_INTEGER + 2, 1e300];
  for (const v of bad) {
    for (const pkg of [{ P0P1: v, P2P3: 500 }, { P0P1: 1000, P2P3: v }, { P0P1: v, P2P3: v }]) {
      const r = run({ commitment: commitment(pkg) });
      assert.notEqual(r.color, 'green', JSON.stringify(pkg));
      assert.ok(r.value === null || Number.isFinite(r.value), JSON.stringify(pkg));
    }
  }
});

test('cat 3/5: umbrales por categoría NaN, Infinity, negativos o > 100 nunca dan verde con un rojo real', () => {
  const bad = [
    { green: 'NaN', yellow: 90 },
    { green: Infinity, yellow: 90 },
    { green: 96, yellow: -Infinity },
    { green: -1, yellow: -2 },
    { green: 101, yellow: 200 },
    { green: null, yellow: null },
    'verde',
    [],
  ];
  for (const t of bad) {
    const ind = indicatorRow();
    ind.thresholds_by_category = { P0P1: t, P2P3: { green: 85, yellow: 75 } };
    let r;
    assert.doesNotThrow(() => {
      r = evaluateCategoryMonth({ indicator: ind, commitment: commitment(), measurements: redRows(), month: '2027-01' });
    }, JSON.stringify(t));
    assert.notEqual(r.color, 'green', JSON.stringify(t));
  }
});

test('cat 3/5: mediciones manipuladas por API (decimal, enorme, negativa, sin categoría) no dan verde', () => {
  const extra = [
    row(0.5, 'P0P1'),
    row(1e300, 'P0P1'),
    row(-100, 'P0P1'),
    row(5000, null),
    row(5000, 'p0p1'),
    row(5000, 'P0P1 '),
    row('1e400', 'P0P1'),
    row(5000, 'P0P1', 'resolved', '2026-12-31'), // fuera del trimestre: se filtra
    row(5000, 'P0P1', 'resolved', '2027-02-01'), // posterior al mes: se filtra
  ];
  for (const e of extra) {
    const r = run({ measurements: [...redRows(), e] });
    assert.notEqual(r.color, 'green', JSON.stringify(e));
  }
});

test('cat 5: lo resuelto se recorta al paquete: inflar una criticidad no compensa la otra', () => {
  const r = run({ measurements: [row(100, 'P0P1'), row(10_000_000, 'P2P3')] });
  assert.equal(r.color, 'red');
  assert.equal(r.byCategory.P2P3.resolved, 500);
});

test('cat 5: una categoría sin paquete o desconocida impide el verde (falla cerrada)', () => {
  const green = [row(1000, 'P0P1'), row(500, 'P2P3')];
  assert.equal(run({ measurements: green }).color, 'green');
  assert.equal(run({ measurements: green, commitment: commitment({ P0P1: 1000 }) }).color, 'not_evaluated');
  const ind = indicatorRow('{"P0P1":{"green":96,"yellow":90},"P2P3":{"green":85,"yellow":75},"P9":{"green":0,"yellow":0}}');
  assert.equal(run({ measurements: green, indicator: ind }).color, 'not_evaluated');
});

test('cat 5: categoryMonthColor ignora sampleSizes heredados del prototipo', () => {
  const ind = indicatorRow();
  const cfg = {
    measurementType: 'cumulative_target',
    direction: 'higher_is_better',
    windowDays: 30,
    thresholds: { green: 96, yellow: 90 },
    thresholdsByCategory: ind.thresholds_by_category,
    frequency: 'monthly',
    minSample: 1,
    source: 'manual',
  };
  const status = packageStatus({
    quarterStart: '2027-01-01', quarterEnd: '2027-03-31', asOf: '2027-01-31',
    initialPackage: { p0p1: 0, p2p3: 0 }, resolved: [],
  });
  const sampleSizes = Object.create({ P0P1: 99, P2P3: 99 });
  const r = categoryMonthColor(cfg, status, { sampleSizes });
  assert.equal(r.color, 'not_evaluated');
  assert.equal(r.sampleSize, 0);
});

test('cat 3: hasCategoryEvaluation solo con objeto no vacío (array, texto, null → no)', () => {
  for (const v of [null, undefined, [], ['P0P1'], 'P0P1', 1, {}]) {
    assert.equal(hasCategoryEvaluation({ measurement_type: 'cumulative_target', thresholds_by_category: v }), false, String(v));
  }
  assert.equal(hasCategoryEvaluation(null), false);
  assert.equal(hasCategoryEvaluation({ measurement_type: 'window_average', thresholds_by_category: { P0P1: {} } }), false);
});

// ---------- Categorías 3 y 4: XSS en etiquetas y metas del líder ----------

test('cat 3/4: categorías con marcado llegan como texto plano al motivo y a la meta del líder', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const ind = indicatorRow(JSON.stringify({ [payload]: { green: 0, yellow: 0 }, P0P1: { green: 96, yellow: 90 } }));
  const r = evaluateCategoryMonth({ indicator: ind, commitment: commitment(), measurements: redRows(), month: '2027-01' });
  assert.equal(typeof r.reason, 'string');
  const goal = categoryGoal({ indicator: ind, commitment: commitment(), measurements: redRows(), month: '2027-01' });
  assert.equal(typeof goal, 'string');
});

test('cat 4/6: la vista del líder pinta meta y motivo con textContent (sin innerHTML)', () => {
  const home = read('../../src/views/unit_leader/home.js');
  const dash = read('../../src/lib/dashboard.js');
  assert.match(home, /text:\s*r\.goal/);
  assert.match(home, /text:\s*r\.reason/);
  for (const [name, src] of [['home.js', home], ['dashboard.js', dash]]) {
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/, name);
  }
});

test('cat 6: el código nuevo del motor no usa eval, red ni asignación dinámica a objetos planos sin hasOwn', () => {
  const vul = read('../../engine/vulnerabilities.js');
  const rows = read('../../engine/rows.js');
  for (const src of [vul, rows]) {
    assert.doesNotMatch(src, /\beval\s*\(|new Function|fetch\s*\(|XMLHttpRequest|process\.env/);
  }
  // Las lecturas por categoría usan Object.hasOwn (no heredan del prototipo).
  assert.match(vul, /Object\.hasOwn\(sampleSizes, cat\)/);
  assert.match(vul, /Object\.hasOwn\(VULN_CATEGORIES, cat\)/);
});

// ---------- Categorías 5 y 8: integración y semilla ----------

test('cat 5: integration.sh borra targets solo tras exigir Supabase en loopback', () => {
  const sh = read('../../scripts/ci/integration.sh');
  const guard = sh.search(/http:\/\/127\.0\.0\.1:\*\|http:\/\/localhost:\*/);
  const del = sh.indexOf('delete from public.targets');
  assert.ok(guard > 0 && del > guard, 'la guarda de loopback debe ir antes del delete');
  assert.doesNotMatch(sh, /sb_secret_[A-Za-z0-9]|supabase\.co|SUPABASE_DB_PASSWORD/);
});

test('cat 8: la semilla sigue siendo ficticia (sin correos ni teléfonos reales)', () => {
  const seed = read('../../supabase/seed.sql');
  const emails = seed.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  for (const e of emails) assert.match(e, /@(example\.(com|org|net)|[a-z0-9-]+\.test|[a-z0-9-]+\.local|[a-z0-9-]+\.invalid)$/i, e);
  assert.doesNotMatch(seed, /\+?593\s?9\d{8}|\b09\d{8}\b/);
});
