// V-01..V-03 — lógica pura de los tableros (src/lib/dashboard.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeExceptions, committeeMatrix, completeness, completenessMonths, describeAlert, evaluatedMonths,
  formatNumber, latestMonth, leaderIndicatorRows, leaderMeasurementsRange, monthOptions, paceAsOf,
  pickMonth, unitEvaluation, pctLabel, historySince, colorKey, colorLabel, levelLabel, restrictionLabel, packagePace,
} from '../../src/lib/dashboard.js';

const U1 = 'u1';
const U2 = 'u2';
const units = [{ id: U2, name: 'Unidad Beta' }, { id: U1, name: 'Unidad Alfa' }];
const VULN = {
  id: 'i-vuln', code: 'VULN', name: 'Vulnerabilidades', measurement_type: 'cumulative_target',
  direction: 'higher_is_better', window_days: 90, green_threshold: 96, yellow_threshold: 90,
  thresholds_by_category: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
  frequency: 'monthly', min_sample: 0, source: 'manual', custodian_user_id: 'c1', active: true,
};
const AVAIL = {
  id: 'i-avail', code: 'AVAIL', name: 'Disponibilidad', measurement_type: 'window_average',
  direction: 'higher_is_better', window_days: 30, green_threshold: 99.9, yellow_threshold: 99.5,
  thresholds_by_category: {}, frequency: 'monthly', min_sample: 0, source: 'manual', custodian_user_id: 'c2', active: true,
};
const OLD = { ...AVAIL, id: 'i-old', code: 'OLD', active: false, custodian_user_id: null };
const indicators = [VULN, AVAIL, OLD];

const ev = (unit_id, indicator_id, month, color, extra = {}) => ({ unit_id, indicator_id, month, color, value: null, restrictions: [], ...extra });
const evaluations = [
  ev(U1, null, '2027-01', 'green', { escalation_level: 'normal' }),
  ev(U1, null, '2027-02', 'yellow', { escalation_level: 'restricted', restrictions: ['no_new_change'] }),
  ev(U1, VULN.id, '2027-02', 'yellow', { value: 55 }),
  ev(U1, AVAIL.id, '2027-02', 'green', { value: 99.95 }),
  ev(U2, null, '2027-02', 'red', { escalation_level: 'frozen' }),
  ev(U2, OLD.id, '2027-02', 'red'),
];

test('meses evaluados, último mes y elección del mes', () => {
  assert.deepEqual(evaluatedMonths(evaluations), ['2027-02', '2027-01']);
  assert.equal(latestMonth(evaluations), '2027-02');
  assert.equal(latestMonth([]), null);
  assert.equal(pickMonth(null, ['2027-02', '2027-01'], '2026-11-19'), '2027-02');
  assert.equal(pickMonth('2027-01', ['2027-02', '2027-01'], '2026-11-19'), '2027-01');
  assert.equal(pickMonth('2026-11', ['2027-02'], '2026-11-19'), '2026-11', 'el mes en curso siempre vale');
  assert.equal(pickMonth('2020-01', ['2027-02'], '2026-11-19'), '2027-02', 'mes no ofrecido -> el último');
  assert.equal(pickMonth('basura', [], '2026-11-19'), '2026-10', 'sin evaluaciones -> el mes anterior');
  assert.equal(pickMonth(null, [], '2027-01-05'), '2026-12');
  assert.deepEqual(monthOptions(['2026-10', '2026-09'], '2026-11-19'), ['2026-11', '2026-10', '2026-09']);
});

test('fecha de referencia del ritmo y rango de mediciones', () => {
  assert.equal(paceAsOf('2026-11', '2026-11-19'), '2026-11-19');
  assert.equal(paceAsOf('2026-10', '2026-11-19'), '2026-10-31');
  assert.equal(paceAsOf('2027-02', '2026-11-19'), '2027-02-28');
  assert.deepEqual(leaderMeasurementsRange('2027-02', '2026-11-19'), { from: '2027-01-01', to: '2027-02-28' });
  assert.deepEqual(leaderMeasurementsRange('2026-12', '2026-12-03'), { from: '2026-10-01', to: '2026-12-03' });
});

test('excepciones vigentes: vencen hoy o después, sin revocadas, por vencimiento', () => {
  const list = [
    { id: 'a', expires_on: '2026-11-30' },
    { id: 'b', expires_on: '2026-11-19' },
    { id: 'c', expires_on: '2026-11-18' },
    { id: 'd', expires_on: '2026-12-01', revoked_at: '2026-11-10T00:00:00Z' },
    { id: 'e' },
    null,
  ];
  assert.deepEqual(activeExceptions(list, '2026-11-19').map((e) => e.id), ['b', 'a']);
  assert.deepEqual(activeExceptions(undefined, '2026-11-19'), []);
});

test('matriz del comité: unidades por nombre, columnas activas o evaluadas, celdas por mes', () => {
  const { columns, rows } = committeeMatrix({ units, indicators, evaluations, month: '2027-02' });
  assert.deepEqual(columns.map((c) => c.code), ['AVAIL', 'OLD', 'VULN']);
  assert.deepEqual(rows.map((r) => r.unit.name), ['Unidad Alfa', 'Unidad Beta']);
  assert.equal(rows[0].global.color, 'yellow');
  assert.equal(rows[0].global.escalation_level, 'restricted');
  assert.deepEqual(rows[0].cells.map((c) => c?.color ?? null), ['green', null, 'yellow']);
  assert.deepEqual(rows[1].cells.map((c) => c?.color ?? null), [null, 'red', null]);
  const jan = committeeMatrix({ units, indicators, evaluations, month: '2027-01' });
  assert.deepEqual(jan.columns.map((c) => c.code), ['AVAIL', 'VULN'], 'el inactivo sin evaluación no se muestra');
  assert.equal(jan.rows[1].global, null);
  assert.equal(unitEvaluation(evaluations, U2, '2027-02').color, 'red');
  assert.equal(unitEvaluation(evaluations, U2, '2027-01'), null);
});

test('filas del líder: color, valor, meta mensual, umbrales y ritmo del motor', () => {
  const commitments = [
    { unit_id: U1, indicator_id: VULN.id, period: '2027-Q1', package_total: 2000, package_by_category: { P0P1: 1500, P2P3: 500 } },
    { unit_id: U1, indicator_id: AVAIL.id, period: '2027-02', green_override: 99.5, yellow_override: 99 },
  ];
  const targets = [{ unit_id: U1, indicator_id: VULN.id, month: '2027-02', target_value: 1333 }];
  const measurements = [
    { unit_id: U1, indicator_id: VULN.id, measured_on: '2027-01-31', value: 450, category: 'P0P1', kind: 'resolved' },
    { unit_id: U1, indicator_id: VULN.id, measured_on: '2027-02-09', value: 100, category: 'P2P3', kind: 'resolved' },
    { unit_id: U1, indicator_id: VULN.id, measured_on: '2027-02-10', value: 200, category: 'P0P1', kind: 'detected' },
    { unit_id: U2, indicator_id: VULN.id, measured_on: '2027-02-10', value: 9999, category: 'P0P1', kind: 'resolved' },
  ];
  const rows = leaderIndicatorRows({
    unitId: U1, indicators, evaluations, targets, commitments, measurements, month: '2027-02', today: '2026-11-19',
  });
  assert.deepEqual(rows.map((r) => r.indicator.code), ['AVAIL', 'VULN'], 'sin el inactivo que solo evaluó otra unidad');
  const [avail, vuln] = rows;
  assert.equal(avail.color, 'green');
  assert.equal(avail.value, 99.95);
  assert.match(avail.goal, /Verde ≥ 99,5; amarillo ≥ 99 \(compromiso\)/);
  assert.equal(avail.pace, null);
  assert.equal(vuln.color, 'yellow');
  assert.match(vuln.goal, /Meta acumulada de 2027-02: 1333/);
  assert.equal(vuln.pace.ok, true);
  assert.equal(vuln.pace.effectiveTotal, 2200, 'las P0/P1 nuevas del mes 2 suman al paquete');
  assert.equal(vuln.pace.resolved, 550, 'solo cuenta lo de su unidad');
  assert.equal(vuln.pace.behindAny, true);
  assert.match(vuln.pace.reason, /Atraso/);

  const jan = leaderIndicatorRows({
    unitId: U1, indicators, evaluations, targets: [], commitments: [], measurements: [], month: '2027-01', today: '2026-11-19',
  });
  assert.equal(jan[0].color, 'not_evaluated');
  assert.equal(jan[0].reason, 'Sin evaluación para este mes');
  assert.match(jan[0].goal, /Verde ≥ 99,9; amarillo ≥ 99,5$/);
  assert.equal(jan[1].goal, 'Sin meta mensual para 2027-01');
  assert.equal(jan[1].pace.ok, false);
  assert.match(jan[1].pace.reason, /Sin paquete por criticidad/);
});

test('ritmo: errores del motor se muestran como texto, no rompen la vista', () => {
  const bad = packagePace({
    indicator: VULN,
    commitment: { package_by_category: { P0P1: 1.5, P2P3: 1 } },
    measurements: [],
    asOf: '2027-02-10',
  });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /No se pudo calcular el ritmo/);
});

test('completitud por custodio y KPI en el mes, con faltantes', () => {
  const measurements = [
    { unit_id: U1, indicator_id: VULN.id, measured_on: '2026-11-01' },
    { unit_id: U1, indicator_id: VULN.id, measured_on: '2026-11-05' },
    { unit_id: U2, indicator_id: VULN.id, measured_on: '2026-10-31' },
    { unit_id: U1, indicator_id: AVAIL.id, measured_on: '2026-11-30' },
    { unit_id: U2, indicator_id: AVAIL.id, measured_on: '2026-11-15' },
    { unit_id: U2, indicator_id: OLD.id, measured_on: '2026-11-15' },
  ];
  const custodians = [{ userId: 'c1', label: 'VULN · usuario c1' }, { userId: 'c2', label: 'AVAIL · usuario c2' }];
  const groups = completeness({ indicators, units, measurements, month: '2026-11', custodians });
  assert.deepEqual(groups.map((g) => [g.custodian, g.pct]), [['AVAIL · usuario c2', 100], ['VULN · usuario c1', 50]]);
  const vuln = groups[1].items[0];
  assert.deepEqual({ loaded: vuln.loaded, total: vuln.total, pct: vuln.pct, missing: vuln.missing },
    { loaded: 1, total: 2, pct: 50, missing: ['Unidad Beta'] });
  assert.deepEqual(groups[0].items[0].missing, []);
  const oct = completeness({ indicators, units, measurements, month: '2026-10', custodians: [] });
  assert.equal(oct.find((g) => g.custodianId === 'c1').pct, 50);
  assert.equal(oct.find((g) => g.custodianId === 'c2').pct, 0);
  assert.match(oct[0].custodian, /^usuario c/);
  const none = completeness({ indicators: [{ ...AVAIL, custodian_user_id: null }], units: [], measurements: [], month: '2026-10' });
  assert.deepEqual(none.map((g) => [g.custodian, g.pct]), [['Sin custodio', null]]);
  assert.equal(pctLabel(null), 'Sin unidades');
  assert.equal(pctLabel(50), '50 %');
  assert.equal(historySince('2026-11-19'), '2025-11');
  assert.deepEqual(completenessMonths('2026-01-10'), ['2026-01', '2025-12']);
});

test('etiquetas y formato: valores desconocidos no rompen ni heredan del prototipo', () => {
  assert.equal(colorLabel('red'), 'Rojo');
  assert.equal(colorLabel(null), 'Sin evaluar');
  assert.equal(colorKey('__proto__'), 'not_evaluated');
  assert.equal(colorKey('green'), 'green');
  assert.equal(levelLabel('frozen'), 'Congelada');
  assert.equal(levelLabel(null), '—');
  assert.equal(restrictionLabel('freeze_all_change'), 'Se frena todo el change');
  assert.equal(restrictionLabel('toString'), 'toString');
  assert.equal(formatNumber(null), '—');
  assert.equal(formatNumber('abc'), '—');
  assert.equal(formatNumber(1333), '1333');
  assert.equal(formatNumber(99.955), '99,96');
});

test('describeAlert: mensaje del payload como texto, tipo y estado', () => {
  const a = describeAlert({ id: 'x', kind: 'color_change', payload: { message: '<img src=x>', severity: 'high' }, sent_at: '2027-02-01T11:07:00Z', read_at: null });
  assert.deepEqual(a, { id: 'x', kind: 'Cambio de color', message: '<img src=x>', sentAt: '2027-02-01 11:07', read: false, high: true });
  const b = describeAlert({ id: 'y', kind: 'pace_behind', payload: null, read_at: '2027-02-02T00:00:00Z' });
  assert.equal(b.message, 'Atraso frente al ritmo');
  assert.equal(b.read, true);
  assert.equal(b.sentAt, '');
});
