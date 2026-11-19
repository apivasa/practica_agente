// QA M-03 — "el custodio registra un umbral negociado que sobrescribe el general".
// El front muestra el umbral efectivo con engine/effectiveThresholds; la Action
// evalúa con scripts/lib/build.js indicatorConfig. CLAUDE.md §6: la lógica vive
// en engine/ y nunca se duplica; ambas rutas deben decidir lo mismo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveThresholds, validateCommitment } from '../../engine/index.js';
import { indicatorConfig } from '../../scripts/lib/build.js';

const row = {
  measurement_type: 'window_average', direction: 'higher_is_better', window_days: 30,
  green_threshold: '99.9', yellow_threshold: '99.5', thresholds_by_category: {},
  frequency: 'monthly', min_sample: 1, source: 'manual',
};

const cases = [
  ['override completo y coherente', { green_override: '99.5', yellow_override: '99' }],
  ['sin override', { green_override: null, yellow_override: null }],
  ['incoherente con el sentido', { green_override: '99', yellow_override: '99.5' }],
  ['solo verde (no lo impide la BD)', { green_override: '99.6', yellow_override: null }],
  ['solo amarillo (no lo impide la BD)', { green_override: null, yellow_override: '99.0' }],
];

for (const [name, c] of cases) {
  test(`front y Action usan el mismo umbral efectivo: ${name}`, () => {
    const eff = effectiveThresholds(row, c);
    const { cfg, thresholdSource } = indicatorConfig(row, c);
    assert.deepEqual(cfg.thresholds, { green: eff.green, yellow: eff.yellow });
    assert.equal(thresholdSource === 'commitment', eff.overridden);
  });
}

test('override negociado sobrescribe el general (camelCase y snake_case)', () => {
  const ind = { direction: 'lower_is_better', thresholds: { green: 24, yellow: 48 } };
  assert.deepEqual(effectiveThresholds(ind, { greenOverride: 36, yellowOverride: 60 }), { green: 36, yellow: 60, overridden: true });
  assert.deepEqual(effectiveThresholds(ind, { green_override: '36', yellow_override: '60' }), { green: 36, yellow: 60, overridden: true });
  // Empate verde = amarillo es coherente en ambos sentidos.
  assert.equal(effectiveThresholds(ind, { greenOverride: 40, yellowOverride: 40 }).overridden, true);
});

test('validateCommitment: periodo, pareja de umbrales y paquete', () => {
  const ind = { measurementType: 'window_average', direction: 'higher_is_better' };
  assert.equal(validateCommitment(ind, { period: '2027-Q5' }).ok, false);
  assert.equal(validateCommitment(ind, { period: '2027-13' }).ok, false);
  assert.equal(validateCommitment(ind, { period: '2027-Q1', greenOverride: 99 }).ok, false);
  assert.equal(validateCommitment(ind, { period: '2027-Q1', greenOverride: 99, yellowOverride: 99.5 }).ok, false);
  assert.equal(validateCommitment(ind, { period: '2027-Q1', greenOverride: NaN, yellowOverride: 1 }).ok, false);
  assert.equal(validateCommitment(ind, { period: '2027-Q1', packageByCategory: { P0P1: 1 } }).ok, false);
  const vuln = { measurementType: 'cumulative_target', direction: 'higher_is_better' };
  assert.equal(validateCommitment(vuln, { period: '2027-03', packageByCategory: { P0P1: -1 } }).ok, false);
  assert.equal(validateCommitment(vuln, { period: '2027-03', packageByCategory: { P0P1: 1.5 } }).ok, false);
  assert.equal(validateCommitment(vuln, { period: '2027-03', packageByCategory: { P0P1: 1500, P2P3: 500 } }).ok, true);
});
