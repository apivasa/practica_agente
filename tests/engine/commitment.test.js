// M-03 — engine/commitment.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCommitment, effectiveThresholds, isValidPeriod, packageTotal } from '../../engine/index.js';

const avail = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
const mttr = { measurementType: 'window_average', direction: 'lower_is_better', thresholds: { green: 4, yellow: 8 } };
const vuln = { measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 } };

test('isValidPeriod: trimestres y meses', () => {
  for (const p of ['2027-Q1', '2027-Q4', '2027-01', '2027-12']) assert.ok(isValidPeriod(p), p);
  for (const p of ['2027-Q5', '2027-13', '2027-00', '27-01', '2027-q1', '', null, '2027-1']) assert.ok(!isValidPeriod(p), String(p));
});

test('effectiveThresholds: sin override usa el general', () => {
  assert.deepEqual(effectiveThresholds(avail, null), { green: 99.9, yellow: 99.5, overridden: false });
  assert.deepEqual(effectiveThresholds(avail, { period: '2027-Q1' }), { green: 99.9, yellow: 99.5, overridden: false });
});

test('effectiveThresholds: el umbral negociado sobrescribe el general', () => {
  assert.deepEqual(effectiveThresholds(avail, { greenOverride: 99.5, yellowOverride: 99 }), { green: 99.5, yellow: 99, overridden: true });
  // Fila de BD (snake_case, numeric como texto).
  const row = { direction: 'lower_is_better', green_threshold: '4', yellow_threshold: '8' };
  assert.deepEqual(effectiveThresholds(row, { green_override: '6', yellow_override: '12' }), { green: 6, yellow: 12, overridden: true });
});

test('effectiveThresholds: override incompleto o incoherente no se aplica y explica por qué', () => {
  const half = effectiveThresholds(avail, { greenOverride: 99 });
  assert.equal(half.overridden, false);
  assert.equal(half.green, 99.9);
  assert.match(half.reason, /incompleto/);
  const wrong = effectiveThresholds(mttr, { greenOverride: 9, yellowOverride: 5 });
  assert.equal(wrong.overridden, false);
  assert.match(wrong.reason, /incoherente/);
  assert.equal(effectiveThresholds(avail, { greenOverride: 'x', yellowOverride: 1 }).overridden, false);
});

test('effectiveThresholds: empate verde = amarillo es coherente', () => {
  assert.equal(effectiveThresholds(mttr, { greenOverride: 5, yellowOverride: 5 }).overridden, true);
});

test('effectiveThresholds: indicador sin umbrales lanza', () => {
  assert.throws(() => effectiveThresholds({ direction: 'higher_is_better' }, null), /umbrales/);
});

test('validateCommitment: periodo, pareja de umbrales y coherencia', () => {
  assert.deepEqual(validateCommitment(avail, { period: '2027-Q1' }), { ok: true, errors: [] });
  assert.ok(validateCommitment(avail, { period: '2027-Q1', greenOverride: 99.6, yellowOverride: 99 }).ok);
  assert.match(validateCommitment(avail, { period: '2027Q1' }).errors[0], /Periodo/);
  assert.match(validateCommitment(avail, { period: '2027-Q1', greenOverride: 99 }).errors[0], /verde y amarillo/);
  assert.match(validateCommitment(avail, { period: '2027-Q1', greenOverride: 98, yellowOverride: 99 }).errors[0], /más es mejor/);
  assert.match(validateCommitment(mttr, { period: '2027-02', greenOverride: 9, yellowOverride: 5 }).errors[0], /menos es mejor/);
  assert.equal(validateCommitment(avail, null).ok, false);
  assert.equal(validateCommitment({}, { period: '2027-01' }).ok, false);
});

test('validateCommitment: paquete por categoría solo en meta acumulada y con enteros >= 0', () => {
  assert.ok(validateCommitment(vuln, { period: '2027-Q1', packageByCategory: { P0P1: 1500, P2P3: 500 } }).ok);
  assert.match(validateCommitment(avail, { period: '2027-Q1', packageByCategory: { a: 1 } }).errors[0], /meta acumulada/);
  assert.match(validateCommitment(vuln, { period: '2027-Q1', packageByCategory: { P0P1: -1 } }).errors[0], /entero/);
  assert.match(validateCommitment(vuln, { period: '2027-Q1', packageByCategory: { P0P1: 1.5 } }).errors[0], /entero/);
  assert.match(validateCommitment(vuln, { period: '2027-Q1', packageByCategory: [] }).errors[0], /objeto/);
  assert.equal(validateCommitment(vuln, { period: '2027-Q1', packageByCategory: JSON.parse('{"__proto__": 1}') }).ok, false);
});

test('packageTotal suma las categorías', () => {
  assert.equal(packageTotal({ P0P1: 1500, P2P3: 500 }), 2000);
  assert.equal(packageTotal({}), null);
  assert.equal(packageTotal(null), null);
});

test('effectiveThresholds: override completo aplica aunque el general sea inválido', () => {
  assert.deepEqual(effectiveThresholds({ direction: 'higher_is_better', green_threshold: 'x' }, { green_override: 99.5, yellow_override: 99 }),
    { green: 99.5, yellow: 99, overridden: true });
});
