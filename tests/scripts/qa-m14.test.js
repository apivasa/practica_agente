// QA M-14 (H-ARQ-M13-01) — de extremo a extremo: lo que acepta la BD lo acepta el motor.
// Trazas:
//  - migración 20261128120000_safe_cap_js_rounding_m14.sql: "Con abs(v) < 9007199254740991.5
//    'pasa en la BD' equivale a 'pasa en el motor': 9007199254740991.4 se lee como 2^53 - 1
//    (válido) y 9007199254740991.5 como 2^53 (inválido). Simétrico en negativos."
//    -> réplica exacta (decimal, sin pasar por double) del CHECK nuevo contra
//       isSafeMagnitude(JSON.parse(texto)) en una malla de literales alrededor del borde.
//  - misma migración: "Un umbral así metido por API hace fallar normalizeIndicator
//    (scripts/lib/run.js) en la evaluación mensual" -> filas como las devuelve PostgREST (numeric
//    como literal JSON) con ±(2^53 - 0,6) en umbrales, umbrales por categoría, overrides, metas y
//    mediciones: runMonthly termina sin errores. Con 2^53 - 0,5 (lo que el CHECK viejo dejaba
//    pasar) la evaluación falla: por eso la BD debe rechazarlo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMonthly } from '../../scripts/lib/run.js';
import { createFakeDb, seedScenario, IDS } from './fake-db.js';
import { isSafeMagnitude, normalizeIndicator, evaluateColor, validateIndicator } from '../../engine/index.js';

const { U, I } = IDS;
const NEW_LIMIT_TENTHS = 90071992547409915n; // 9007199254740991.5 * 10
const OLD_LIMIT = 9007199254740992n;

/** Partes exactas de un literal decimal "[-]ent[.frac]" (sin exponente). */
function parseDecimal(text) {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`literal no soportado: ${text}`);
  const frac = m[3] ?? '';
  return { abs: BigInt(m[2] + frac), scale: frac.length };
}
/** Réplica exacta del CHECK de M-14: abs(v) < 9007199254740991.5 (comparación numeric). */
function dbAcceptsM14(text) {
  const { abs, scale } = parseDecimal(text);
  // abs / 10^scale < LIMIT_TENTHS / 10  <=>  abs * 10 < LIMIT_TENTHS * 10^scale
  return abs * 10n < NEW_LIMIT_TENTHS * 10n ** BigInt(scale);
}
/** Réplica exacta del CHECK anterior (M-11/M-12): abs(v) < 9007199254740992. */
function dbAcceptsOld(text) {
  const { abs, scale } = parseDecimal(text);
  return abs < OLD_LIMIT * 10n ** BigInt(scale);
}

const FRACS = ['', '.0', '.1', '.4', '.49', '.4999999999', '.4999999999999999999', '.5', '.5000000001', '.51', '.6', '.9', '.9999999999'];
const BASES = ['9007199254740990', '9007199254740991', '9007199254740992', '9007199254740993'];
const GRID = BASES.flatMap((b) => FRACS.map((f) => b + f)).flatMap((t) => [t, `-${t}`]);

test('QA M-14: el CHECK nuevo coincide con isSafeMagnitude(JSON.parse) en toda la malla del borde, con ambos signos', () => {
  for (const text of GRID) {
    assert.equal(dbAcceptsM14(text), isSafeMagnitude(JSON.parse(text)), `literal ${text}`);
  }
});

test('QA M-14: el front parsea igual que JSON.parse (Number) en la malla del borde', () => {
  for (const text of GRID) assert.equal(Number(text), JSON.parse(text), `literal ${text}`);
});

test('QA M-14: el borde exacto es 2^53 - 0,5: .4 y .4999999999 pasan, .5 y .5000000001 no', () => {
  for (const t of ['9007199254740991.4', '9007199254740991.4999999999', '-9007199254740991.4']) {
    assert.equal(dbAcceptsM14(t), true, t);
    assert.equal(JSON.parse(t), Math.sign(JSON.parse(t)) * Number.MAX_SAFE_INTEGER, t);
  }
  for (const t of ['9007199254740991.5', '9007199254740991.5000000001', '-9007199254740991.5']) {
    assert.equal(dbAcceptsM14(t), false, t);
    assert.equal(Math.abs(JSON.parse(t)), 2 ** 53, t);
  }
});

test('QA M-14 regresión: el CHECK anterior aceptaba literales que el motor rechaza (el hueco que cierra M-14)', () => {
  const gap = GRID.filter((t) => dbAcceptsOld(t) && !isSafeMagnitude(JSON.parse(t)));
  assert.ok(gap.includes('9007199254740991.5') && gap.includes('-9007199254740991.9999999999'), gap.join(', '));
  assert.ok(gap.every((t) => !dbAcceptsM14(t)), 'el CHECK nuevo rechaza todo el hueco');
});

// ---------------------------------------------------------------- extremo a extremo

/**
 * Simula la respuesta de PostgREST: serializa y sustituye los marcadores "@nombre" por el
 * literal numeric tal como sale de la BD; luego JSON.parse (lo que hace supabase-js).
 */
function viaPostgrest(value, literals) {
  let text = JSON.stringify(value);
  for (const [k, lit] of Object.entries(literals)) text = text.split(`"@${k}"`).join(lit);
  return JSON.parse(text);
}

function scenarioWith(lit) {
  const s = seedScenario();
  const avail = s.indicators.find((i) => i.id === I.avail);
  const mttr = s.indicators.find((i) => i.id === I.mttr);
  const vuln = s.indicators.find((i) => i.id === I.vuln);
  avail.yellow_threshold = '@neg'; // más es mejor: verde 99,9 > amarillo -(2^53 - x)
  mttr.yellow_threshold = '@pos'; // menos es mejor: verde 4 < amarillo 2^53 - x
  vuln.thresholds_by_category = { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: '@neg' } };
  const ov = s.commitments.find((c) => c.indicator_id === I.avail && c.unit_id === U.gamma);
  ov.green_override = 99.5;
  ov.yellow_override = '@neg';
  // Meta acumulada sin categorías (usa targets) con meta 2^53 - x y una medición en ese valor.
  s.indicators.push({ ...mttr, id: 'i-cum', code: 'CUM', measurement_type: 'cumulative_target',
    direction: 'higher_is_better', window_days: 90, green_threshold: 95, yellow_threshold: 90, min_sample: 0 });
  s.targets.push({ unit_id: U.alfa, indicator_id: 'i-cum', month: '2027-01', target_value: '@pos' });
  s.measurements.push({ unit_id: U.alfa, indicator_id: 'i-cum', measured_on: '2027-01-20', value: '@pos',
    app_id: null, compliant: null, category: null, kind: 'resolved', created_at: '2027-01-20T12:00:00Z' });
  // Promedio con una medición en 2^53 - x.
  s.measurements.push({ unit_id: U.beta, indicator_id: I.avail, measured_on: '2027-01-16', value: '@pos',
    app_id: null, compliant: null, category: null, kind: null, created_at: '2027-01-16T12:00:00Z' });
  return viaPostgrest(s, { pos: lit, neg: `-${lit}` });
}

test('QA M-14 e2e: con ±(2^53 - 0,6) en umbrales, categorías, override, meta y medición, runMonthly termina sin errores', async () => {
  const data = scenarioWith('9007199254740991.4');
  assert.equal(data.indicators.find((i) => i.id === I.mttr).yellow_threshold, Number.MAX_SAFE_INTEGER);
  const db = createFakeDb(data);
  const r = await runMonthly(db, { asOf: '2027-02-01' });
  assert.deepEqual(r.errors, []);
  const ev = (u, i) => db.tables.evaluations.find((e) => e.unit_id === u && e.indicator_id === i && e.month === '2027-01');
  // Todas las unidades evaluadas (fila global) y los indicadores tocados tienen color.
  for (const u of [U.alfa, U.beta, U.gamma]) assert.ok(ev(u, null), `fila global de ${u}`);
  assert.equal(ev(U.alfa, I.mttr).color, 'green', 'MTTR Alfa 3,5 h <= verde 4 con amarillo 2^53 - 1');
  assert.equal(ev(U.alfa, I.avail).color, 'green', 'AVAIL Alfa 99,95 >= verde 99,9');
  const g = ev(U.gamma, I.avail);
  assert.equal(g.color, 'green', 'Gamma 99,6 >= override verde 99,5 (amarillo -(2^53 - 1))');
  assert.match(g.reason, /compromiso/, 'se aplicó el override con amarillo -(2^53 - 1)');
  assert.notEqual(ev(U.alfa, 'i-cum'), undefined, 'meta acumulada con meta 2^53 - 1 evaluada');
});

test('QA M-14 e2e: el literal 2^53 - 0,5 (aceptado por el CHECK anterior) hace fallar la evaluación', async () => {
  const db = createFakeDb(scenarioWith('9007199254740991.5'));
  const r = await runMonthly(db, { asOf: '2027-02-01' });
  assert.ok(r.errors.length > 0, 'el motor rechaza 2^53: la BD es la que debe impedir guardarlo');
  assert.ok(r.errors.every((e) => /2\^53/.test(e)), r.errors.join(' | '));
});

test('QA M-14 motor: normalizeIndicator y evaluateColor aceptan umbrales leídos de ±(2^53 - 0,6)', () => {
  const row = JSON.parse('{"green":9007199254740991.4,"yellow":-9007199254740991.4}');
  const cfg = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: row };
  assert.equal(validateIndicator(cfg).ok, true);
  assert.doesNotThrow(() => normalizeIndicator(cfg));
  const c = evaluateColor(cfg, { value: JSON.parse('9007199254740991.4'), sampleSize: 1 });
  assert.equal(c.color, 'green');
  const bad = { ...cfg, thresholds: JSON.parse('{"green":9007199254740991.5,"yellow":0}') };
  assert.throws(() => normalizeIndicator(bad), /2\^53/);
});
