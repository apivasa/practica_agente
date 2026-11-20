// M-07 (pruebas del desarrollador): propuesta de un tercio, indicadores que usan `targets` y
// evaluateIndicatorMonth en el motor (movida desde scripts/lib/build.js, misma regla).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cumulativeThirds, proposeThirdTarget, usesMonthlyTargets, evaluateIndicatorMonth, toEngineMeasurements,
  packageStatus,
} from '../../engine/index.js';
import * as build from '../../scripts/lib/build.js';

const PLAIN = {
  id: 'ind-1', measurement_type: 'cumulative_target', direction: 'higher_is_better', window_days: 90,
  green_threshold: 90, yellow_threshold: 80, thresholds_by_category: {}, frequency: 'monthly', min_sample: 0, source: 'manual',
};
const commitment = (period, packageTotal, extra = {}) => ({ unit_id: 'u1', indicator_id: 'ind-1', period, package_total: packageTotal, ...extra });

describe('cumulativeThirds', () => {
  test('un tercio, dos tercios y el total, acumulados, con redondeo hacia arriba en meses 1 y 2', () => {
    assert.deepEqual(cumulativeThirds(30), [10, 20, 30]);
    assert.deepEqual(cumulativeThirds(2000), [667, 1334, 2000]);
    assert.deepEqual(cumulativeThirds(1), [1, 1, 1]);
    assert.deepEqual(cumulativeThirds(0), [0, 0, 0]);
  });
  test('es la misma serie que packageStatus.monthlyTargets', () => {
    const s = packageStatus({
      quarterStart: '2027-01-01', quarterEnd: '2027-03-31', asOf: '2027-01-15',
      initialPackage: { p0p1: 1500, p2p3: 500 }, newCritical: [], resolved: [],
    });
    assert.deepEqual(s.monthlyTargets.map((t) => t.cumulativeTarget), cumulativeThirds(2000));
  });
  test('rechaza totales no válidos', () => {
    for (const bad of [-1, Number.NaN, Infinity, '30', null]) assert.throws(() => cumulativeThirds(bad), TypeError);
  });
});

describe('proposeThirdTarget', () => {
  const commitments = [commitment('2026-Q4', 30), commitment('2026-11', null, { green_override: 95, yellow_override: 85 })];
  test('meta acumulada por mes del trimestre desde el paquete del compromiso trimestral', () => {
    const at = (month) => proposeThirdTarget({ commitments, unitId: 'u1', indicatorId: 'ind-1', month });
    assert.equal(at('2026-10').value, 10);
    assert.equal(at('2026-11').value, 20, 'usa el trimestral aunque exista un compromiso mensual');
    assert.equal(at('2026-12').value, 30);
    const p = at('2026-10');
    assert.equal(p.ok, true);
    assert.equal(p.quarter, '2026-Q4');
    assert.equal(p.monthIndex, 1);
    assert.equal(p.packageTotal, 30);
    assert.match(p.explanation, /un tercio del paquete de 30/);
  });
  test('package_total como texto (numeric de PostgREST) se acepta', () => {
    const r = proposeThirdTarget({ commitments: [commitment('2027-Q1', '2000')], unitId: 'u1', indicatorId: 'ind-1', month: '2027-02' });
    assert.equal(r.value, 1334);
  });
  test('sin compromiso trimestral, sin paquete o con mes inválido: motivo, sin lanzar', () => {
    const none = proposeThirdTarget({ commitments: [], unitId: 'u1', indicatorId: 'ind-1', month: '2026-10' });
    assert.equal(none.ok, false);
    assert.match(none.reason, /Sin compromiso trimestral \(2026-Q4\)/);
    const other = proposeThirdTarget({ commitments, unitId: 'u2', indicatorId: 'ind-1', month: '2026-10' });
    assert.equal(other.ok, false);
    const noPkg = proposeThirdTarget({ commitments: [commitment('2026-Q4', null)], unitId: 'u1', indicatorId: 'ind-1', month: '2026-10' });
    assert.match(noPkg.reason, /no tiene paquete total/);
    const bad = proposeThirdTarget({ commitments, unitId: 'u1', indicatorId: 'ind-1', month: '2026-13' });
    assert.match(bad.reason, /Mes inválido/);
  });
});

describe('usesMonthlyTargets', () => {
  test('solo meta acumulada sin categorías', () => {
    assert.equal(usesMonthlyTargets(PLAIN), true);
    assert.equal(usesMonthlyTargets({ ...PLAIN, thresholds_by_category: null }), true);
    assert.equal(usesMonthlyTargets({ ...PLAIN, thresholds_by_category: { P0P1: { green: 96, yellow: 90 } } }), false);
    assert.equal(usesMonthlyTargets({ ...PLAIN, measurement_type: 'window_average' }), false);
    assert.equal(usesMonthlyTargets(null), false);
  });
});

describe('evaluateIndicatorMonth en el motor', () => {
  test('scripts/lib/build.js reexporta las mismas funciones (una sola regla)', () => {
    assert.equal(build.evaluateIndicatorMonth, evaluateIndicatorMonth);
    assert.equal(build.toEngineMeasurements, toEngineMeasurements);
  });
  test('un indicador pasa de "sin evaluar" a color al cargar la meta del mes', () => {
    const rows = [{ unit_id: 'u1', indicator_id: 'ind-1', measured_on: '2026-10-15', value: 10, kind: 'resolved' }];
    const before = evaluateIndicatorMonth({ indicator: PLAIN, measurements: rows, target: null, evalMonth: '2026-10' });
    assert.equal(before.color, 'not_evaluated');
    assert.match(before.reason, /Falta la meta/);
    const green = evaluateIndicatorMonth({ indicator: PLAIN, measurements: rows, target: { target_value: 10 }, evalMonth: '2026-10' });
    assert.equal(green.color, 'green');
    assert.equal(green.value, 100);
    const red = evaluateIndicatorMonth({ indicator: PLAIN, measurements: rows, target: { target_value: 20 }, evalMonth: '2026-10' });
    assert.equal(red.color, 'red');
    assert.equal(red.value, 50);
  });
  test('cuenta el día 1 de un trimestre de 92 días aunque window_days sea 30', () => {
    const rows = [{ measured_on: '2026-10-01', value: 9, kind: 'resolved' }, { measured_on: '2026-12-31', value: 1, kind: 'resolved' }];
    const r = evaluateIndicatorMonth({ indicator: { ...PLAIN, window_days: 30 }, measurements: rows, target: { target_value: 10 }, evalMonth: '2026-12' });
    assert.equal(r.value, 100);
  });
});
