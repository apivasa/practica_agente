// M-13 (H-QA-M12-01): el motor y el front aplican el mismo tope que la BD, |v| < 2^53.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAFE_ABS_LIMIT, isSafeMagnitude, validateIndicator, validateCommitment, validateMeasurementInput,
} from '../../engine/index.js';
import { buildIndicatorRow } from '../../src/lib/indicator-form.js';
import { buildCommitmentFields } from '../../src/lib/commitment-form.js';

const MAX = Number.MAX_SAFE_INTEGER; // 2^53 - 1
const base = { measurementType: 'window_average', direction: 'higher_is_better' };

test('SAFE_ABS_LIMIT es 2^53 e isSafeMagnitude es exclusivo', () => {
  assert.equal(SAFE_ABS_LIMIT, 9007199254740992);
  assert.equal(isSafeMagnitude(MAX), true);
  assert.equal(isSafeMagnitude(-MAX), true);
  assert.equal(isSafeMagnitude(2 ** 53), false);
  assert.equal(isSafeMagnitude(-(2 ** 53)), false);
  assert.equal(isSafeMagnitude(1e20), false);
  assert.equal(isSafeMagnitude(Number.NaN), false);
  assert.equal(isSafeMagnitude('1'), false);
});

test('validateIndicator: umbral 1e20 rechazado con mensaje; 2^53-1 aceptado', () => {
  const r = validateIndicator({ ...base, thresholds: { green: 1e20, yellow: 1 } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /thresholds\.green: fuera de rango.*2\^53/);
  assert.equal(validateIndicator({ ...base, thresholds: { green: MAX, yellow: -MAX } }).ok, true);
  const c = validateIndicator({ ...base, thresholds: { green: 2, yellow: 1 }, thresholdsByCategory: { A: { green: 1, yellow: -(2 ** 53) } } });
  assert.equal(c.ok, false);
  assert.match(c.errors.join(' '), /thresholdsByCategory\.A\.yellow: fuera de rango/);
});

test('buildIndicatorRow: umbral de categoría 1e20 con mensaje de pantalla', () => {
  const values = {
    code: 'X', name: 'x', measurement_type: 'window_average', direction: 'higher_is_better',
    green: '96', yellow: '90', categories: [{ name: 'A', green: '100000000000000000000', yellow: '1' }],
  };
  const r = buildIndicatorRow(values);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /Umbral de la categoría A\.green: fuera de rango/);
  const g = buildIndicatorRow({ ...values, categories: [], green: '9007199254740992' });
  assert.equal(g.ok, false);
  assert.match(g.errors.join(' '), /Umbral verde: fuera de rango/);
  const ok = buildIndicatorRow({ ...values, categories: [], green: String(MAX) });
  assert.equal(ok.ok, true);
  assert.equal(ok.row.green_threshold, MAX);
});

test('validateCommitment: overrides, paquete y total con el tope', () => {
  const ind = { measurementType: 'cumulative_target', direction: 'higher_is_better' };
  const o = validateCommitment(ind, { period: '2027-Q1', greenOverride: 1e20, yellowOverride: 1 });
  assert.equal(o.ok, false);
  assert.match(o.errors.join(' '), /Umbral verde negociado: fuera de rango/);
  const p = validateCommitment(ind, { period: '2027-Q1', packageByCategory: { P0P1: 2 ** 53 } });
  assert.equal(p.ok, false);
  assert.match(p.errors.join(' '), /Paquete de P0P1: fuera de rango/);
  const t = validateCommitment(ind, { period: '2027-Q1', packageByCategory: { P0P1: MAX, P2P3: 1 } });
  assert.equal(t.ok, false);
  assert.match(t.errors.join(' '), /Paquete total: fuera de rango/);
  assert.equal(validateCommitment(ind, { period: '2027-Q1', packageByCategory: { P0P1: MAX - 1, P2P3: 1 } }).ok, true);
  assert.equal(validateCommitment(ind, { period: '2027-Q1', greenOverride: MAX, yellowOverride: 0 }).ok, true);
});

test('buildCommitmentFields: paquete enorme con mensaje en español', () => {
  const ind = { measurementType: 'cumulative_target', direction: 'higher_is_better' };
  const r = buildCommitmentFields(ind, { period: '2027-Q1', packages: { P0P1: '100000000000000000000' } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /Paquete de P0P1: fuera de rango/);
});

test('validateMeasurementInput: medición 2^53 rechazada, 2^53-1 aceptada', () => {
  const ctx = { units: [{ id: 'u1', name: 'Unidad A' }], today: '2026-11-20' };
  for (const measurementType of ['window_average', 'cumulative_target']) {
    const ind = { measurementType, direction: 'higher_is_better' };
    const bad = validateMeasurementInput(ind, { fecha: '2026-11-01', unidad: 'Unidad A', valor: '9007199254740992' }, ctx);
    assert.equal(bad.ok, false, measurementType);
    assert.match(bad.errors.map((e) => e.message).join(' '), /valor: fuera de rango.*2\^53/);
    const ok = validateMeasurementInput(ind, { fecha: '2026-11-01', unidad: 'Unidad A', valor: String(MAX) }, ctx);
    assert.equal(ok.ok, true, measurementType);
    assert.equal(ok.row.value, MAX);
  }
  const avg = { measurementType: 'window_average', direction: 'higher_is_better' };
  const big = validateMeasurementInput(avg, { fecha: '2026-11-01', unidad: 'Unidad A', valor: '100000000000000000000.5' }, ctx);
  assert.equal(big.ok, false);
});
