import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, parseDay, REASON_MISSING_TARGET, REASON_OUT_OF_RANGE } from '../../engine/index.js';

const avg = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99, yellow: 95 } };
const cov = { ...avg, measurementType: 'coverage' };
const cum = { ...avg, measurementType: 'cumulative_target', windowDays: 90 };

test('parseDay', () => {
  assert.equal(parseDay('1970-01-02'), 1);
  assert.equal(parseDay('2026-02-30'), null);
  assert.equal(parseDay('2026-13-01'), null);
  assert.equal(parseDay('2026-1-01'), null);
  assert.equal(parseDay('2026-01-01T00:00:00Z'), null);
  assert.equal(parseDay(20260101), null);
  assert.equal(parseDay('2024-02-29'), parseDay('2024-02-28') + 1);
});

test('asOf y measurements inválidos', () => {
  assert.throws(() => measure(avg, [], { asOf: '2026-11-31' }), /asOf/);
  assert.throws(() => measure(avg, [], undefined), /asOf/);
  assert.throws(() => measure(avg, null, { asOf: '2026-11-30' }), /measurements/);
  assert.throws(() => measure({}, [], { asOf: '2026-11-30' }), /Indicador inválido/);
});

test('window_average: promedio en ventana', () => {
  const r = measure(avg, [{ date: '2026-11-01', value: 98 }, { date: '2026-11-30', value: 100 }], { asOf: '2026-11-30' });
  assert.deepEqual(r, { value: 99, sampleSize: 2 });
});

test('window_average: límites inclusivos de la ventana (30 días)', () => {
  const ms = [
    { date: '2026-10-31', value: 0 }, // fuera: asOf-30
    { date: '2026-11-01', value: 10 }, // dentro: asOf-29 (primer día)
    { date: '2026-11-30', value: 20 }, // dentro: asOf
    { date: '2026-12-01', value: 1000 }, // fuera: futuro
  ];
  assert.deepEqual(measure(avg, ms, { asOf: '2026-11-30' }), { value: 15, sampleSize: 2 });
});

test('window_average: ventana de 1 día y cruce de año', () => {
  const one = { ...avg, windowDays: 1 };
  const ms = [{ date: '2025-12-31', value: 5 }, { date: '2026-01-01', value: 7 }];
  assert.deepEqual(measure(one, ms, { asOf: '2026-01-01' }), { value: 7, sampleSize: 1 });
  assert.deepEqual(measure({ ...avg, windowDays: 2 }, ms, { asOf: '2026-01-01' }), { value: 6, sampleSize: 2 });
});

test('window_average: ventana vacía e ignorados', () => {
  assert.deepEqual(measure(avg, [], { asOf: '2026-11-30' }), { value: null, sampleSize: 0 });
  const ms = [null, 'x', { date: 'mal', value: 1 }, { date: '2026-11-10' }, { date: '2026-11-10', value: NaN }];
  assert.deepEqual(measure(avg, ms, { asOf: '2026-11-30' }), { value: null, sampleSize: 0 });
});

test('filtro por categoría', () => {
  const ms = [
    { date: '2026-11-10', value: 10, category: 'A' },
    { date: '2026-11-10', value: 30, category: 'B' },
  ];
  assert.deepEqual(measure(avg, ms, { asOf: '2026-11-30', category: 'B' }), { value: 30, sampleSize: 1 });
  assert.deepEqual(measure(avg, ms, { asOf: '2026-11-30' }), { value: 20, sampleSize: 2 });
  assert.deepEqual(measure(avg, ms, { asOf: '2026-11-30', category: 'Z' }), { value: null, sampleSize: 0 });
});

test('coverage: usa la última medición de cada app', () => {
  const ms = [
    { date: '2026-11-20', appId: 'a1', compliant: true },
    { date: '2026-11-05', appId: 'a1', compliant: false }, // más antigua: no cuenta
    { date: '2026-11-05', appId: 'a2', compliant: true },
    { date: '2026-11-25', appId: 'a2', compliant: false },
    { date: '2026-11-10', appId: 'a3', compliant: true },
    { date: '2026-11-10', appId: 'a4', compliant: 'yes' }, // no es true estricto
  ];
  assert.deepEqual(measure(cov, ms, { asOf: '2026-11-30' }), { value: 50, sampleSize: 4 });
});

test('coverage: misma fecha gana la posterior en el arreglo', () => {
  const ms = [
    { date: '2026-11-20', appId: 'a1', compliant: false },
    { date: '2026-11-20', appId: 'a1', compliant: true },
  ];
  assert.deepEqual(measure(cov, ms, { asOf: '2026-11-30' }), { value: 100, sampleSize: 1 });
});

test('coverage: mediciones fuera de ventana no cuentan para "última"', () => {
  const ms = [
    { date: '2026-11-10', appId: 'a1', compliant: true },
    { date: '2026-12-05', appId: 'a1', compliant: false },
  ];
  assert.deepEqual(measure(cov, ms, { asOf: '2026-11-30' }), { value: 100, sampleSize: 1 });
});

test('coverage: vacía o sin appId', () => {
  assert.deepEqual(measure(cov, [], { asOf: '2026-11-30' }), { value: null, sampleSize: 0 });
  const ms = [{ date: '2026-11-10', compliant: true }, { date: '2026-11-10', appId: '', compliant: true }];
  assert.deepEqual(measure(cov, ms, { asOf: '2026-11-30' }), { value: null, sampleSize: 0 });
});

test('cumulative_target: % de avance', () => {
  const ms = [
    { date: '2026-01-15', value: 300 },
    { date: '2026-02-15', value: 500 },
    { date: '2025-12-31', value: 999 }, // fuera de 90 días desde 2026-03-31
  ];
  // ventana 90 días termina 2026-03-31 → empieza 2026-01-01
  assert.deepEqual(measure(cum, ms, { asOf: '2026-03-31', target: 2000 }), { value: 40, sampleSize: 2 });
  assert.deepEqual(measure(cum, ms, { asOf: '2026-03-31', target: 400 }), { value: 200, sampleSize: 2 });
});

test('cumulative_target: target 0 → 100', () => {
  const ms = [{ date: '2026-01-15', value: 0 }];
  assert.deepEqual(measure(cum, ms, { asOf: '2026-03-31', target: 0 }), { value: 100, sampleSize: 1 });
});

test('cumulative_target: target ausente o null → sin valor con razón', () => {
  const ms = [{ date: '2026-01-15', value: 5 }];
  for (const opts of [{ asOf: '2026-03-31' }, { asOf: '2026-03-31', target: undefined }, { asOf: '2026-03-31', target: null }]) {
    assert.deepEqual(measure(cum, ms, opts), { value: null, sampleSize: 1, reason: REASON_MISSING_TARGET });
  }
  assert.deepEqual(measure(cum, [], { asOf: '2026-03-31' }), { value: null, sampleSize: 0, reason: REASON_MISSING_TARGET });
});

test('valores negativos se ignoran en window_average y cumulative_target', () => {
  const ms = [{ date: '2026-03-01', value: -500 }, { date: '2026-03-02', value: 10 }];
  assert.deepEqual(measure(cum, ms, { asOf: '2026-03-31', target: 10 }), { value: 100, sampleSize: 1 });
  assert.deepEqual(measure(avg, ms, { asOf: '2026-03-31' }), { value: 10, sampleSize: 1 });
  assert.deepEqual(measure(avg, [{ date: '2026-03-01', value: -1 }], { asOf: '2026-03-31' }), { value: null, sampleSize: 0 });
});

test('desbordamiento → value null con razón (no Infinity)', () => {
  const big = [{ date: '2026-03-20', value: 1e308 }, { date: '2026-03-21', value: 1e308 }];
  assert.deepEqual(measure(avg, big, { asOf: '2026-03-31' }), { value: null, sampleSize: 2, reason: REASON_OUT_OF_RANGE });
  assert.deepEqual(measure(cum, big, { asOf: '2026-03-31', target: 1 }), { value: null, sampleSize: 2, reason: REASON_OUT_OF_RANGE });
});

test('coverage: 57 de 100 apps da exactamente 57', () => {
  const ms = Array.from({ length: 100 }, (_, i) => ({ date: '2026-11-10', appId: `a${i}`, compliant: i < 57 }));
  assert.deepEqual(measure(cov, ms, { asOf: '2026-11-30' }), { value: 57, sampleSize: 100 });
});

test('cumulative_target: ventana vacía y target inválido', () => {
  assert.deepEqual(measure(cum, [], { asOf: '2026-03-31', target: 2000 }), { value: null, sampleSize: 0 });
  for (const t of [-1, NaN, '2000']) {
    assert.throws(() => measure(cum, [], { asOf: '2026-03-31', target: t }), /target/);
  }
});
