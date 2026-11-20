// M-07 (pruebas del desarrollador): lógica pura de la pantalla de metas.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTargetFields, parseMonth, measurementsRange, targetIndicators, targetRows, TARGET_MAX,
} from '../../src/lib/targets-form.js';
import { resolveRoute, routesForRole } from '../../src/lib/route-logic.js';

const PLAIN = {
  id: 'i1', code: 'PATCH', active: true, measurement_type: 'cumulative_target', direction: 'higher_is_better', window_days: 90,
  green_threshold: 90, yellow_threshold: 80, thresholds_by_category: {}, frequency: 'monthly', min_sample: 0, source: 'manual',
};
const VULN = { ...PLAIN, id: 'i2', code: 'VULN', thresholds_by_category: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } } };
const AVAIL = { ...PLAIN, id: 'i3', code: 'AVAIL', measurement_type: 'window_average' };

describe('targetIndicators', () => {
  test('solo activos de meta acumulada sin categorías, por código', () => {
    const z = { ...PLAIN, id: 'i4', code: 'ZZZ' };
    const off = { ...PLAIN, id: 'i5', code: 'AAA', active: false };
    assert.deepEqual(targetIndicators([z, VULN, AVAIL, off, PLAIN]).map((i) => i.code), ['PATCH', 'ZZZ']);
    assert.deepEqual(targetIndicators(null), []);
  });
});

describe('parseMonth y measurementsRange', () => {
  test('acepta AAAA-MM y rechaza lo demás', () => {
    assert.deepEqual(parseMonth(' 2026-10 '), { ok: true, month: '2026-10' });
    for (const bad of ['2026-13', '2026-1', '26-10', '', null, '2026-10-01']) assert.equal(parseMonth(bad).ok, false, String(bad));
  });
  test('del día 1 del trimestre al cierre del mes', () => {
    assert.deepEqual(measurementsRange('2026-11'), { from: '2026-10-01', to: '2026-11-30' });
    assert.deepEqual(measurementsRange('2027-02'), { from: '2027-01-01', to: '2027-02-28' });
  });
});

describe('buildTargetFields', () => {
  test('valor >= 0 con punto o coma decimal', () => {
    assert.deepEqual(buildTargetFields({ month: '2026-10', value: '10' }), { ok: true, fields: { month: '2026-10', target_value: 10 } });
    assert.equal(buildTargetFields({ month: '2026-10', value: '0' }).fields.target_value, 0);
    assert.equal(buildTargetFields({ month: '2026-10', value: '12,5' }).fields.target_value, 12.5);
  });
  test('errores con mensaje', () => {
    assert.match(buildTargetFields({ month: '2026-10', value: '' }).errors[0], /obligatoria/);
    assert.match(buildTargetFields({ month: '2026-10', value: '-1' }).errors[0], /mayor o igual que 0/);
    assert.match(buildTargetFields({ month: '2026-10', value: 'abc' }).errors[0], /mayor o igual que 0/);
    assert.match(buildTargetFields({ month: '2026-10', value: String(TARGET_MAX * 10) }).errors[0], /demasiado grande/);
    const both = buildTargetFields({ month: 'x', value: '' });
    assert.equal(both.ok, false);
    assert.equal(both.errors.length, 2);
  });
});

describe('targetRows', () => {
  const units = [{ id: 'u2', name: 'Unidad Beta' }, { id: 'u1', name: 'Unidad Alfa' }];
  const commitments = [{ unit_id: 'u1', indicator_id: 'i1', period: '2026-Q4', package_total: 30 }];
  const measurements = [
    { unit_id: 'u1', indicator_id: 'i1', measured_on: '2026-10-15', value: 10, kind: 'resolved' },
    { unit_id: 'u2', indicator_id: 'i1', measured_on: '2026-10-15', value: 99, kind: 'resolved' },
  ];
  test('sin meta: sin evaluar; con meta: color del motor; propuesta y paquete por unidad', () => {
    const before = targetRows({ indicator: PLAIN, units, targets: [], commitments, measurements, month: '2026-10' });
    assert.deepEqual(before.map((r) => r.unit.name), ['Unidad Alfa', 'Unidad Beta']);
    assert.equal(before[0].evaluation.color, 'not_evaluated');
    assert.equal(before[0].target, null);
    assert.equal(before[0].packageTotal, 30);
    assert.equal(before[0].proposal.value, 10);
    assert.equal(before[1].proposal.ok, false);
    assert.equal(before[1].packageTotal, null);

    const targets = [{ id: 't1', unit_id: 'u1', indicator_id: 'i1', month: '2026-10', target_value: 10 }];
    const after = targetRows({ indicator: PLAIN, units, targets, commitments, measurements, month: '2026-10' });
    assert.equal(after[0].evaluation.color, 'green');
    assert.equal(after[0].target.target_value, 10);
    assert.equal(after[1].evaluation.color, 'not_evaluated', 'la meta de otra unidad no aplica');
  });
  test('una meta de otro mes no aplica', () => {
    const targets = [{ id: 't1', unit_id: 'u1', indicator_id: 'i1', month: '2026-11', target_value: 10 }];
    const rows = targetRows({ indicator: PLAIN, units, targets, commitments, measurements, month: '2026-10' });
    assert.equal(rows[0].evaluation.color, 'not_evaluated');
  });
  test('un dato que el motor rechaza queda sin evaluar con motivo (no rompe la pantalla)', () => {
    const targets = [{ id: 't1', unit_id: 'u1', indicator_id: 'i1', month: '2026-10', target_value: -5 }];
    const rows = targetRows({ indicator: PLAIN, units, targets, commitments, measurements, month: '2026-10' });
    assert.equal(rows[0].evaluation.color, 'not_evaluated');
    assert.match(rows[0].evaluation.reason, /No se pudo calcular/);
  });
});

describe('ruta #/gestora/metas', () => {
  test('solo la gestora llega; el resto vuelve a su inicio', () => {
    assert.ok(routesForRole('kpi_manager').some((r) => r.path === '/gestora/metas'));
    assert.equal(resolveRoute('/gestora/metas', { authenticated: true, roles: ['kpi_manager'] }).view, 'kpi-targets');
    for (const role of ['custodian', 'committee', 'unit_leader']) {
      assert.notEqual(resolveRoute('/gestora/metas', { authenticated: true, roles: [role] }).view, 'kpi-targets', role);
    }
    assert.equal(resolveRoute('/gestora/metas', { authenticated: false }).view, 'login');
  });
});
