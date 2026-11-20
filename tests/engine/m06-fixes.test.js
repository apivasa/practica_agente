// M-06, intento 2 (pruebas del desarrollador): A1 (mismo compromiso trimestral en front y
// Actions), H-M06-01 (filas malformadas se descartan sin anular el mes) y H-M06-02 (num).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCategoryMonth, num } from '../../engine/rows.js';
import { leaderIndicatorRows, packagePace } from '../../src/lib/dashboard.js';
import { runDaily } from '../../scripts/lib/run.js';
import { createFakeDb, seedScenario, IDS } from '../scripts/fake-db.js';

const VULN = {
  id: 'v', code: 'VULN', measurement_type: 'cumulative_target', direction: 'higher_is_better', window_days: 90,
  green_threshold: 96, yellow_threshold: 90,
  thresholds_by_category: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
  frequency: 'monthly', min_sample: 0, source: 'manual', active: true,
};
const Q = { unit_id: 'u', indicator_id: 'v', period: '2027-Q1', package_by_category: { P0P1: 300, P2P3: 300 } };
const MONTHLY = { unit_id: 'u', indicator_id: 'v', period: '2027-02', package_by_category: null, green_override: 50, yellow_override: 10 };
const row = (measured_on, category, value, kind = 'resolved') => ({ unit_id: 'u', indicator_id: 'v', measured_on, category, value, kind });
const rows = [row('2027-01-20', 'P0P1', 100), row('2027-01-20', 'P2P3', 100), row('2027-02-05', 'P0P1', 50)];

describe('A1: el compromiso mensual sin paquete no rompe el ritmo del líder', () => {
  test('mismo ritmo y meta con o sin compromiso mensual, igual al trimestral', () => {
    const base = { unitId: 'u', indicators: [VULN], evaluations: [], targets: [], measurements: rows, month: '2027-02', today: '2027-02-10' };
    const [withMonthly] = leaderIndicatorRows({ ...base, commitments: [MONTHLY, Q] });
    const [onlyQuarter] = leaderIndicatorRows({ ...base, commitments: [Q] });
    assert.equal(withMonthly.pace.ok, true, withMonthly.pace.reason);
    assert.deepEqual(withMonthly.pace, onlyQuarter.pace);
    assert.equal(withMonthly.goal, onlyQuarter.goal);
    assert.deepEqual(withMonthly.pace, packagePace({ indicator: VULN, commitment: Q, measurements: rows, asOf: '2027-02-10' }));
  });

  test('la Action diaria usa el mismo compromiso trimestral', async () => {
    const { U, I } = IDS;
    const data = seedScenario();
    data.commitments.push({ unit_id: U.alfa, indicator_id: I.vuln, period: '2027-02', package_by_category: null, green_override: 50, yellow_override: 10 });
    const r = await runDaily(createFakeDb(data), { asOf: '2027-02-10' });
    assert.deepEqual(r.errors, []);
    assert.equal(r.snapshots, 3);
  });
});

describe('H-M06-01: filas malformadas se descartan por fila', () => {
  const red = [row('2027-01-20', 'P0P1', 10), row('2027-01-20', 'P2P3', 100)];
  for (const [label, bad] of [
    ['valor decimal', row('2027-01-21', 'P0P1', 0.5)],
    ['categoría nula', row('2027-01-21', null, 5)],
    ['categoría desconocida', row('2027-01-21', 'p0p1', 5)],
    ['valor negativo', row('2027-01-21', 'P2P3', -3)],
    ['detectada con valor decimal', row('2027-01-21', 'P0P1', 1.5, 'detected')],
  ]) {
    test(`${label}: el mes conserva su color y el motivo la menciona`, () => {
      const r = evaluateCategoryMonth({ indicator: VULN, commitment: Q, measurements: [...red, bad], month: '2027-01' });
      assert.equal(r.color, 'red');
      assert.equal(r.discarded, 1);
      assert.match(r.reason, /1 medición\(es\) descartada\(s\)/);
    });
  }

  test('fuera del trimestre no cuenta como descartada; sin malformadas no hay nota', () => {
    const r = evaluateCategoryMonth({ indicator: VULN, commitment: Q, measurements: [...red, row('2026-12-31', null, 1)], month: '2027-01' });
    assert.equal(r.discarded, undefined);
    assert.doesNotMatch(r.reason, /descartada/);
  });
});

test('H-M06-02: num solo acepta números o texto numérico', () => {
  assert.equal(num(5), 5);
  assert.equal(num('7'), 7);
  assert.equal(num(' 8 '), 8);
  for (const v of [null, undefined, '', '  ', [], [0], false, true, {}, NaN, Infinity, 'abc']) assert.equal(num(v), null, String(v));
  const r = evaluateCategoryMonth({
    indicator: VULN, commitment: { package_by_category: { P0P1: [], P2P3: 300 } }, measurements: rows, month: '2027-01',
  });
  assert.equal(r.color, 'not_evaluated', 'un paquete malformado no se toma como 0');
});
