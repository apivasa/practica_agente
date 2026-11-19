import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateColor, measure, tolerance, REASON_MISSING_TARGET } from '../../engine/index.js';

const hib = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99, yellow: 95 } };
const lib = { measurementType: 'window_average', direction: 'lower_is_better', thresholds: { green: 4, yellow: 8 }, minSample: 3 };

const c = (cfg, value, sampleSize = 10, opts) => evaluateColor(cfg, { value, sampleSize }, opts).color;

test('higher_is_better: verde, amarillo, rojo', () => {
  assert.equal(c(hib, 99.5), 'green');
  assert.equal(c(hib, 97), 'yellow');
  assert.equal(c(hib, 94.9), 'red');
});

test('higher_is_better: empates exactos = color mejor', () => {
  assert.equal(c(hib, 99), 'green');
  assert.equal(c(hib, 95), 'yellow');
});

test('lower_is_better: verde, amarillo, rojo y empates', () => {
  assert.equal(c(lib, 3), 'green');
  assert.equal(c(lib, 4), 'green');
  assert.equal(c(lib, 6), 'yellow');
  assert.equal(c(lib, 8), 'yellow');
  assert.equal(c(lib, 8.01), 'red');
});

test('umbrales iguales: no existe amarillo', () => {
  const eq = { ...hib, thresholds: { green: 90, yellow: 90 } };
  assert.equal(c(eq, 90), 'green');
  assert.equal(c(eq, 89.99), 'red');
});

test('sin datos → not_evaluated', () => {
  const r = evaluateColor(hib, { value: null, sampleSize: 0 });
  assert.equal(r.color, 'not_evaluated');
  assert.match(r.reason, /Sin datos/);
  assert.equal(evaluateColor(hib, undefined).color, 'not_evaluated');
});

test('mínimo de muestra', () => {
  const r = evaluateColor(lib, { value: 2, sampleSize: 2 });
  assert.equal(r.color, 'not_evaluated');
  assert.match(r.reason, /Muestra insuficiente: 2 de 3/);
  assert.equal(c(lib, 2, 3), 'green'); // justo en el mínimo sí se evalúa
  assert.equal(evaluateColor(lib, { value: 2 }).color, 'not_evaluated'); // sampleSize ausente = 0
});

test('valor no numérico lanza', () => {
  assert.throws(() => evaluateColor(hib, { value: '99', sampleSize: 1 }), /measured.value/);
  assert.throws(() => evaluateColor(hib, { value: NaN, sampleSize: 1 }), /measured.value/);
});

test('config inválida lanza', () => {
  assert.throws(() => evaluateColor({}, { value: 1, sampleSize: 1 }), /Indicador inválido/);
});

test('umbrales por categoría', () => {
  const vul = {
    measurementType: 'cumulative_target',
    direction: 'higher_is_better',
    thresholds: { green: 90, yellow: 80 },
    thresholdsByCategory: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
  };
  assert.equal(c(vul, 95, 1, { category: 'P0P1' }), 'yellow');
  assert.equal(c(vul, 96, 1, { category: 'P0P1' }), 'green');
  assert.equal(c(vul, 85, 1, { category: 'P2P3' }), 'green');
  assert.equal(c(vul, 74, 1, { category: 'P2P3' }), 'red');
  // Categoría sin umbrales propios o ausente → umbrales generales.
  assert.equal(c(vul, 85, 1, { category: 'otra' }), 'yellow');
  assert.equal(c(vul, 85, 1), 'yellow');
  // No se confunde con propiedades heredadas.
  assert.equal(c(vul, 85, 1, { category: 'toString' }), 'yellow');
  assert.match(evaluateColor(vul, { value: 96, sampleSize: 1 }, { category: 'P0P1' }).reason, /categoría P0P1/);
});

test('reason describe la comparación', () => {
  assert.match(evaluateColor(hib, { value: 99, sampleSize: 1 }).reason, /99 >= verde 99/);
  assert.match(evaluateColor(hib, { value: 90, sampleSize: 1 }).reason, /90 < amarillo 95/);
  assert.match(evaluateColor(lib, { value: 9, sampleSize: 3 }).reason, /9 > amarillo 8/);
});

test('integración measure → evaluateColor: ventana vacía no se evalúa', () => {
  const m = measure(lib, [{ date: '2026-01-01', value: 1 }], { asOf: '2026-11-30' });
  assert.equal(evaluateColor(lib, m).color, 'not_evaluated');
});

test('integración: ejemplo MTTR del README', () => {
  const mttr = { ...lib, windowDays: 30 };
  const m = measure(mttr, [
    { date: '2026-11-02', value: 3 },
    { date: '2026-11-10', value: 5 },
    { date: '2026-11-18', value: 4 },
  ], { asOf: '2026-11-30' });
  assert.deepEqual(m, { value: 4, sampleSize: 3 });
  assert.deepEqual(evaluateColor(mttr, m), { color: 'green', reason: 'Valor 4 <= verde 4' });
});

test('empate calculado (coma flotante) = color mejor, en ambos sentidos', () => {
  assert.equal(c(hib, (99.9 + 99.8 + 100) / 3), 'green'); // 99.89999999999999
  assert.equal(c(hib, 94.99999999999999), 'yellow');
  assert.equal(c({ ...lib, thresholds: { green: 2.3, yellow: 8 } }, (2.2 + 2.3 + 2.4) / 3, 3), 'green'); // 2.3000000000000003
  assert.equal(c({ ...lib, thresholds: { green: 2.3, yellow: 8 } }, 8.000000000000002, 3), 'yellow');
});

test('la tolerancia no oculta diferencias reales', () => {
  assert.equal(c(hib, 99 - 1e-6), 'yellow');
  assert.equal(c(lib, 4 + 1e-6, 3), 'yellow');
  assert.equal(tolerance(0), 1e-9);
  assert.ok(Math.abs(tolerance(-2000) - 2e-6) < 1e-18);
});

test('sampleSize inválido → not_evaluated', () => {
  for (const s of [NaN, 'x', 1.5, -1, Infinity, null]) {
    const r = evaluateColor(hib, { value: 99, sampleSize: s });
    if (s === null) {
      assert.equal(r.color, 'green'); // null se toma como ausente (0) y minSample es 0
    } else {
      assert.equal(r.color, 'not_evaluated', `sampleSize=${String(s)}`);
      assert.match(r.reason, /Tamaño de muestra inválido/);
    }
  }
});

test('value null con reason de measure la propaga', () => {
  const cum = { measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 96, yellow: 85 } };
  const m = measure(cum, [{ date: '2026-11-01', value: 5 }], { asOf: '2026-11-30' });
  assert.deepEqual(evaluateColor(cum, m), { color: 'not_evaluated', reason: REASON_MISSING_TARGET });
});
