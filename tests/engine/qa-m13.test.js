// QA M-13 (H-QA-M12-01) — pruebas independientes del tope |v| < 2^53 antes de guardar.
// Trazas:
//  - plan-maestro M-13: "Tope 2^53 validado en front/motor antes de guardar" y criterio
//    "Unitarias: umbral 1e20 y medición 2^53 rechazados con mensaje".
//  - docs/reportes/M-12-qa.md H-QA-M12-01: el resultado debe ser "un mensaje del formulario
//    en lugar de un error 23514 de la BD"; aplica a umbrales generales, umbrales por categoría
//    y a todas las mediciones (formulario y CSV).
//  - migraciones M-11/M-12: la BD acepta |v| < 9007199254740992 (exclusivo) en umbrales,
//    overrides, package_total, package_by_category y measurements.value -> 2^53-1 debe pasar
//    y 2^53 no, con ambos signos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAFE_ABS_LIMIT, SAFE_ABS_LIMIT_TEXT, isSafeMagnitude,
  validateIndicator, validateCommitment, validateMeasurementInput, parseMeasurementsCsv,
} from '../../engine/index.js';
import { buildIndicatorRow } from '../../src/lib/indicator-form.js';
import { buildCommitmentFields } from '../../src/lib/commitment-form.js';

const MAX = 9007199254740991; // 2^53 - 1, el mayor que acepta la BD
const LIM = 9007199254740992; // 2^53, el primero que rechaza la BD
const RANGE = /fuera de rango.*2\^53/;

/** Réplica literal del CHECK de la BD: abs(v) < 9007199254740992. */
const dbAccepts = (v) => Math.abs(v) < 9007199254740992;

const wa = (direction = 'higher_is_better') => ({ measurementType: 'window_average', direction });
const units = [{ id: 'u-alfa', name: 'Unidad Alfa' }];
const ctx = { units };

// ---------------------------------------------------------------- numeric.js

test('QA M-13 tope: SAFE_ABS_LIMIT coincide con el literal del CHECK de la BD', () => {
  assert.equal(SAFE_ABS_LIMIT, LIM);
  assert.match(SAFE_ABS_LIMIT_TEXT, /2\^53/);
  assert.match(SAFE_ABS_LIMIT_TEXT, /9007199254740992/);
});

test('QA M-13 tope: isSafeMagnitude coincide con el CHECK de la BD en los bordes ±', () => {
  const cases = [0, -0, 1, -1, 0.5, Number.MIN_VALUE, MAX, -MAX, MAX - 1, LIM, -LIM, LIM + 2, -(LIM + 2),
    1e20, -1e20, Number.MAX_VALUE, -Number.MAX_VALUE];
  for (const v of cases) assert.equal(isSafeMagnitude(v), dbAccepts(v), `v=${v}`);
});

test('QA M-13 tope: isSafeMagnitude rechaza lo que no es número finito', () => {
  for (const v of [Number.NaN, Infinity, -Infinity, '1', '', null, undefined, true, {}, [], 1n, Object(1)]) {
    assert.equal(isSafeMagnitude(v), false, `v=${String(v)}`);
  }
});

// ---------------------------------------------------------------- umbrales del indicador

test('QA M-13 indicador: umbral general 1e20 rechazado con mensaje (verde y amarillo)', () => {
  const g = validateIndicator({ ...wa(), thresholds: { green: 1e20, yellow: 1 } });
  assert.equal(g.ok, false);
  assert.ok(g.errors.some((e) => e.startsWith('thresholds.green') && RANGE.test(e)), g.errors.join(' | '));
  const y = validateIndicator({ ...wa('lower_is_better'), thresholds: { green: 1, yellow: 1e20 } });
  assert.equal(y.ok, false);
  assert.ok(y.errors.some((e) => e.startsWith('thresholds.yellow') && RANGE.test(e)), y.errors.join(' | '));
});

test('QA M-13 indicador: borde exacto 2^53 y -2^53 rechazados; ±(2^53-1) aceptados', () => {
  assert.equal(validateIndicator({ ...wa(), thresholds: { green: LIM, yellow: 0 } }).ok, false);
  assert.equal(validateIndicator({ ...wa(), thresholds: { green: 0, yellow: -LIM } }).ok, false);
  assert.equal(validateIndicator({ ...wa(), thresholds: { green: MAX, yellow: -MAX } }).ok, true);
  assert.equal(validateIndicator({ ...wa('lower_is_better'), thresholds: { green: -MAX, yellow: MAX } }).ok, true);
});

test('QA M-13 indicador: -0 es válido (|−0| = 0)', () => {
  assert.equal(validateIndicator({ ...wa(), thresholds: { green: -0, yellow: -0 } }).ok, true);
});

test('QA M-13 indicador: ambos fuera de rango dan dos mensajes de rango y ninguno de coherencia', () => {
  // higher_is_better con verde < amarillo sería incoherente, pero primero manda el tope.
  const r = validateIndicator({ ...wa(), thresholds: { green: -1e20, yellow: 1e20 } });
  assert.equal(r.ok, false);
  assert.equal(r.errors.filter((e) => RANGE.test(e)).length, 2, r.errors.join(' | '));
  assert.ok(!r.errors.some((e) => e.includes('más es mejor')), r.errors.join(' | '));
});

test('QA M-13 indicador: Number.MAX_VALUE (finito) también se rechaza por rango, no por "no finito"', () => {
  const r = validateIndicator({ ...wa(), thresholds: { green: Number.MAX_VALUE, yellow: 0 } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /thresholds\.green: fuera de rango/);
});

test('QA M-13 indicador: umbral por categoría 1e20 / 2^53 rechazado; 2^53-1 aceptado', () => {
  const base = { ...wa(), thresholds: { green: 2, yellow: 1 } };
  const a = validateIndicator({ ...base, thresholdsByCategory: { Alta: { green: 1e20, yellow: 1 } } });
  assert.equal(a.ok, false);
  assert.match(a.errors.join(' '), /thresholdsByCategory\.Alta\.green: fuera de rango.*2\^53/);
  const b = validateIndicator({ ...base, thresholdsByCategory: { Baja: { green: 2, yellow: -LIM } } });
  assert.equal(b.ok, false);
  assert.match(b.errors.join(' '), /thresholdsByCategory\.Baja\.yellow: fuera de rango/);
  assert.equal(validateIndicator({ ...base, thresholdsByCategory: { Alta: { green: MAX, yellow: -MAX } } }).ok, true);
});

// ---------------------------------------------------------------- formulario de indicadores (front)

const form = {
  code: 'QA-M13', name: 'QA M13', description: '', measurement_type: 'window_average',
  direction: 'higher_is_better', window_days: '30', green: '96', yellow: '90', categories: [],
  frequency: 'monthly', min_sample: '0', source: 'manual', active: true,
};

test('QA M-13 pantalla indicadores: umbral 2^53 muestra mensaje con etiqueta de pantalla', () => {
  const g = buildIndicatorRow({ ...form, green: '9007199254740992' });
  assert.equal(g.ok, false);
  assert.ok(g.errors.some((e) => /^Umbral verde: fuera de rango/.test(e) && RANGE.test(e)), g.errors.join(' | '));
  const y = buildIndicatorRow({ ...form, yellow: '-9007199254740992' });
  assert.equal(y.ok, false);
  assert.ok(y.errors.some((e) => /^Umbral amarillo: fuera de rango/.test(e)), y.errors.join(' | '));
  // Ningún mensaje queda con el nombre interno del motor.
  assert.ok(![...g.errors, ...y.errors].some((e) => e.startsWith('thresholds')));
});

test('QA M-13 pantalla indicadores: el número del reporte H-QA-M12-01 ya no sale con ok:true', () => {
  // Repro literal del hallazgo: categoría A con verde 99999999999999999999.
  const r = buildIndicatorRow({ ...form, categories: [{ name: 'A', green: '99999999999999999999', yellow: '1' }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /Umbral de la categoría A\.green: fuera de rango/);
  // Y el umbral general 9007199254740993 (redondea a 2^53).
  assert.equal(buildIndicatorRow({ ...form, green: '9007199254740993' }).ok, false);
});

test('QA M-13 pantalla indicadores: ±(2^53-1) se guardan tal cual (lo que la BD acepta)', () => {
  const r = buildIndicatorRow({ ...form, green: '9007199254740991', yellow: '-9007199254740991',
    categories: [{ name: 'A', green: '9007199254740991', yellow: '-9007199254740991' }] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.row.green_threshold, MAX);
  assert.equal(r.row.yellow_threshold, -MAX);
  assert.deepEqual(r.row.thresholds_by_category, { A: { green: MAX, yellow: -MAX } });
  for (const v of [r.row.green_threshold, r.row.yellow_threshold]) assert.ok(dbAccepts(v));
});

test('QA M-13 pantalla indicadores: notación exponencial y 1e400 se rechazan con mensaje, nunca ok', () => {
  for (const t of ['1e20', '1E20', '1e400', '-1e400', '9.007199254740992e15']) {
    const r = buildIndicatorRow({ ...form, green: t });
    assert.equal(r.ok, false, t);
    assert.ok(r.errors.some((e) => e.startsWith('Umbral verde')), `${t}: ${r.errors.join(' | ')}`);
  }
});

test('QA M-13 pantalla indicadores: decimal con coma justo bajo 2^53 que redondea a 2^53 se rechaza', () => {
  // 9007199254740991,5 en double es 2^53: lo que llegaría a la BD (vía JSON) es 9007199254740992.
  const r = buildIndicatorRow({ ...form, green: '9007199254740991,5', yellow: '0' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /Umbral verde: fuera de rango/);
});

// ---------------------------------------------------------------- compromisos

const ct = { measurementType: 'cumulative_target', direction: 'higher_is_better',
  thresholds: { green: 96, yellow: 90 }, thresholdsByCategory: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 96, yellow: 90 } } };

test('QA M-13 compromiso: overrides ±2^53 rechazados con mensaje; ±(2^53-1) aceptados', () => {
  const a = validateCommitment(ct, { period: '2027-Q1', greenOverride: LIM, yellowOverride: 1 });
  assert.equal(a.ok, false);
  assert.match(a.errors.join(' '), /Umbral verde negociado: fuera de rango.*2\^53/);
  const b = validateCommitment(ct, { period: '2027-Q1', greenOverride: 1, yellowOverride: -LIM });
  assert.equal(b.ok, false);
  assert.match(b.errors.join(' '), /Umbral amarillo negociado: fuera de rango/);
  assert.equal(validateCommitment(ct, { period: '2027-Q1', greenOverride: MAX, yellowOverride: -MAX }).ok, true);
});

test('QA M-13 compromiso: overrides en snake_case (fila de la BD) también pasan por el tope', () => {
  const r = validateCommitment(ct, { period: '2027-Q1', green_override: 1e20, yellow_override: 1 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /Umbral verde negociado: fuera de rango/);
});

test('QA M-13 compromiso: overrides fuera de rango no generan además mensaje de coherencia', () => {
  const r = validateCommitment(ct, { period: '2027-Q1', greenOverride: -1e20, yellowOverride: 1e20 });
  assert.equal(r.ok, false);
  assert.equal(r.errors.filter((e) => /fuera de rango/.test(e)).length, 2, r.errors.join(' | '));
  assert.ok(!r.errors.some((e) => e.includes('más es mejor')), r.errors.join(' | '));
});

test('QA M-13 compromiso: paquete por categoría 2^53 rechazado; 2^53-1 aceptado', () => {
  const r = validateCommitment(ct, { period: '2027-Q1', packageByCategory: { P0P1: LIM } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /Paquete de P0P1: fuera de rango.*2\^53/);
  assert.equal(validateCommitment(ct, { period: '2027-Q1', packageByCategory: { P0P1: MAX } }).ok, true);
});

test('QA M-13 compromiso: package_total = suma; borde exacto 2^53-1 aceptado y 2^53 rechazado', () => {
  const ok = validateCommitment(ct, { period: '2027-Q1', packageByCategory: { P0P1: MAX - 1, P2P3: 1 } });
  assert.equal(ok.ok, true, ok.errors.join(' | '));
  const half = 2 ** 52;
  const bad = validateCommitment(ct, { period: '2027-Q1', packageByCategory: { P0P1: half, P2P3: half } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /Paquete total: fuera de rango/);
  // Cada parte por sí sola es válida: el único mensaje es el del total.
  assert.equal(bad.errors.length, 1, bad.errors.join(' | '));
});

test('QA M-13 pantalla compromisos: mensajes de rango para overrides y paquetes', () => {
  const g = buildCommitmentFields(ct, { period: '2027-Q1', green: '9007199254740992', yellow: '1', packages: {}, notes: '' });
  assert.equal(g.ok, false);
  assert.match(g.errors.join(' '), /Umbral verde negociado: fuera de rango/);
  const p = buildCommitmentFields(ct, { period: '2027-Q1', green: '', yellow: '', packages: { P0P1: '99999999999999999999' }, notes: '' });
  assert.equal(p.ok, false);
  assert.match(p.errors.join(' '), /Paquete de P0P1: fuera de rango/);
  const t = buildCommitmentFields(ct, { period: '2027-Q1', green: '', yellow: '',
    packages: { P0P1: '4503599627370496', P2P3: '4503599627370496' }, notes: '' });
  assert.equal(t.ok, false);
  assert.match(t.errors.join(' '), /Paquete total: fuera de rango/);
});

test('QA M-13 pantalla compromisos: 2^53-1 se guarda y package_total cabe en la BD', () => {
  const r = buildCommitmentFields(ct, { period: '2027-Q1', green: '9007199254740991', yellow: '-9007199254740991',
    packages: { P0P1: '9007199254740990', P2P3: '1' }, notes: '' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.fields.green_override, MAX);
  assert.equal(r.fields.package_total, MAX);
  assert.ok(dbAccepts(r.fields.package_total));
});

// ---------------------------------------------------------------- mediciones (formulario)

const ok = (r) => (r.ok ? r.row.value : `ERR ${r.errors.map((e) => e.message).join('; ')}`);
const msgs = (r) => (r.ok ? '' : r.errors.map((e) => e.message).join(' | '));

test('QA M-13 medición promedio: 2^53 rechazada con mensaje; 2^53-1 aceptada', () => {
  const bad = validateMeasurementInput(wa(), { fecha: '2026-11-02', unidad: 'Unidad Alfa', valor: '9007199254740992' }, ctx);
  assert.equal(bad.ok, false);
  assert.match(msgs(bad), /valor: fuera de rango.*2\^53/);
  assert.equal(bad.errors[0].field, 'valor');
  const good = validateMeasurementInput(wa(), { fecha: '2026-11-02', unidad: 'Unidad Alfa', valor: '9007199254740991' }, ctx);
  assert.equal(ok(good), MAX);
});

test('QA M-13 medición acumulada (entera): 2^53 y 2^53+1 rechazadas; 2^53-1 aceptada', () => {
  const ind = { measurementType: 'cumulative_target', thresholdsByCategory: {} };
  for (const v of ['9007199254740992', '9007199254740993']) {
    const r = validateMeasurementInput(ind, { fecha: '2026-11-02', unidad: 'Unidad Alfa', valor: v }, ctx);
    assert.equal(r.ok, false, v);
    assert.match(msgs(r), /valor: fuera de rango.*2\^53/, v);
  }
  const g = validateMeasurementInput(ind, { fecha: '2026-11-02', unidad: 'Unidad Alfa', valor: '9007199254740991' }, ctx);
  assert.equal(ok(g), MAX);
});

test('QA M-13 medición: 1e20, 1e400 y 400 dígitos se rechazan con mensaje, nunca se guardan', () => {
  for (const v of ['1e20', '1E20', '1e400', '99999999999999999999', '1' + '0'.repeat(400), '1'.repeat(400) + ',5']) {
    const r = validateMeasurementInput(wa(), { fecha: '2026-11-02', unidad: 'Unidad Alfa', valor: v }, ctx);
    assert.equal(r.ok, false, v.slice(0, 20));
    assert.ok(r.errors.some((e) => e.field === 'valor'), msgs(r));
  }
});

test('QA M-13 medición: el valor guardado siempre cumple el CHECK de la BD (barrido cerca del borde)', () => {
  const texts = [];
  for (let d = -3; d <= 3; d += 1) texts.push((BigInt(LIM) + BigInt(d)).toString());
  texts.push('9007199254740991,4', '9007199254740991,5', '9007199254740991.9999', '0', '0,0');
  for (const t of texts) {
    const r = validateMeasurementInput(wa(), { fecha: '2026-11-02', unidad: 'Unidad Alfa', valor: t }, ctx);
    if (r.ok) assert.ok(dbAccepts(r.row.value), `${t} -> ${r.row.value} pasaría y la BD lo rechaza`);
    else assert.match(msgs(r), /valor: fuera de rango/, t);
  }
});

test('QA M-13 medición: -0 y negativos no llegan al tope (se frenan como fórmula/negativo)', () => {
  const r = validateMeasurementInput(wa(), { fecha: '2026-11-02', unidad: 'Unidad Alfa', valor: '-0' }, ctx);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'valor'));
});

// ---------------------------------------------------------------- mediciones (CSV)

test('QA M-13 CSV promedio: fila 2^53 y "1e400" rechazadas fila a fila; no se guarda nada', () => {
  const csv = [
    'fecha,unidad,valor',
    '2026-11-01,Unidad Alfa,9007199254740991',
    '2026-11-02,Unidad Alfa,9007199254740992',
    '2026-11-03,Unidad Alfa,"1e400"',
    '2026-11-04,Unidad Alfa,1e20',
  ].join('\n');
  const r = parseMeasurementsCsv(csv, wa(), ctx);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.errors.map((e) => e.row), [3, 4, 5]);
  assert.match(r.errors[0].message, /valor: fuera de rango.*2\^53/);
  assert.match(r.errors[1].message, /valor: "1e400"/);
  assert.match(r.errors[2].message, /valor: "1e20"/);
});

test('QA M-13 CSV con ";" y coma decimal: 9007199254740991,0 aceptado; 9007199254740992,0 rechazado', () => {
  const okCsv = 'fecha;unidad;valor\r\n2026-11-01;Unidad Alfa;9007199254740991,0\r\n';
  const a = parseMeasurementsCsv(okCsv, wa(), ctx);
  assert.deepEqual(a.errors, []);
  assert.equal(a.rows[0].value, MAX);
  const badCsv = 'fecha;unidad;valor\r\n2026-11-01;Unidad Alfa;9007199254740992,0\r\n';
  const b = parseMeasurementsCsv(badCsv, wa(), ctx);
  assert.equal(b.rows.length, 0);
  assert.match(b.errors[0].message, /valor: fuera de rango/);
});

test('QA M-13 CSV acumulado con categorías: 2^53 rechazado; 2^53-1 aceptado', () => {
  const ind = { measurementType: 'cumulative_target', thresholdsByCategory: { P0P1: { green: 1, yellow: 0 } } };
  const csv = 'fecha,unidad,valor,categoria,tipo\n2026-11-01,Unidad Alfa,9007199254740991,P0P1,resuelta\n';
  const a = parseMeasurementsCsv(csv, ind, ctx);
  assert.deepEqual(a.errors, []);
  assert.equal(a.rows[0].value, MAX);
  const b = parseMeasurementsCsv(csv.replace('9007199254740991', '9007199254740992'), ind, ctx);
  assert.equal(b.rows.length, 0);
  assert.match(b.errors[0].message, /valor: fuera de rango/);
});
