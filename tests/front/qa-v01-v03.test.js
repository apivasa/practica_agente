// QA V-01..V-03 — casos de borde de los tableros (src/lib/dashboard.js, engine/calendar.js,
// engine/rows.js). Cada caso traza al criterio del plan:
//  V-01 "líder: sus indicadores, color, meta mensual, avance vs. ritmo y restricciones; no ve otras unidades"
//  V-02 "comité: todas las unidades (matriz unidad × indicador), alertas, excepciones"
//  V-03 "gestora: % cargado por custodio y KPI; qué datos faltan para el comité del mes"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  committeeMatrix, completeness, leaderIndicatorRows, pickMonth, monthOptions, unitEvaluation,
  activeExceptions, colorLabel, colorKey, leaderMeasurementsRange, completenessMonths,
} from '../../src/lib/dashboard.js';
import { addMonths, monthEnd, quarterBounds } from '../../engine/calendar.js';
import { pickCommitment } from '../../engine/rows.js';

const A = 'unit-a';
const B = 'unit-b';
const C = 'unit-c';
const units = [
  { id: C, name: 'Unidad Gamma' },
  { id: A, name: 'Unidad Alfa' },
  { id: B, name: 'Unidad Beta' },
];
const VULN = {
  id: 'i-vuln', code: 'VULN', name: 'Vulnerabilidades', measurement_type: 'cumulative_target',
  direction: 'higher_is_better', window_days: 90, green_threshold: 96, yellow_threshold: 90,
  thresholds_by_category: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
  frequency: 'monthly', min_sample: 0, source: 'manual', custodian_user_id: 'cust-1', active: true,
};
const INC = {
  id: 'i-inc', code: 'INC', name: 'Incidentes', measurement_type: 'window_average',
  direction: 'lower_is_better', window_days: 30, green_threshold: 5, yellow_threshold: 10,
  thresholds_by_category: {}, frequency: 'monthly', min_sample: 3, source: 'manual', custodian_user_id: 'cust-2', active: true,
};
const ev = (unit_id, indicator_id, month, color, extra = {}) => ({
  unit_id, indicator_id, month, color, value: null, reason: null, restrictions: [], ...extra,
});

// ---------------------------------------------------------------- V-02: unidad sin evaluaciones
test('V-02: una unidad sin evaluaciones aparece en la matriz con todas sus celdas vacías', () => {
  const evaluations = [ev(A, null, '2027-02', 'green'), ev(A, INC.id, '2027-02', 'green')];
  const { columns, rows } = committeeMatrix({ units, indicators: [VULN, INC], evaluations, month: '2027-02' });
  assert.deepEqual(rows.map((r) => r.unit.name), ['Unidad Alfa', 'Unidad Beta', 'Unidad Gamma'], 'todas las unidades');
  assert.equal(columns.length, 2);
  for (const r of rows.filter((x) => x.unit.id !== A)) {
    assert.equal(r.global, null);
    assert.deepEqual(r.cells, [null, null]);
  }
  assert.equal(unitEvaluation(evaluations, B, '2027-02'), null);
});

test('V-02: sin unidades ni evaluaciones la matriz queda vacía, sin errores', () => {
  const m = committeeMatrix({ units: [], indicators: [VULN], evaluations: [], month: '2027-02' });
  assert.deepEqual(m.rows, []);
  assert.deepEqual(m.columns.map((c) => c.code), ['VULN']);
  const n = committeeMatrix({ units: undefined, indicators: undefined, evaluations: undefined, month: '2027-02' });
  assert.deepEqual(n, { columns: [], rows: [] });
});

// ---------------------------------------------------------------- mes sin datos
test('mes sin datos: el líder ve sus indicadores sin evaluar, sin meta mensual y sin paquete', () => {
  const evaluations = [ev(A, VULN.id, '2027-01', 'green')];
  const rows = leaderIndicatorRows({
    unitId: A, indicators: [VULN, INC], evaluations, targets: [], commitments: [], measurements: [],
    month: '2027-03', today: '2027-03-10',
  });
  assert.deepEqual(rows.map((r) => r.indicator.code), ['INC', 'VULN']);
  for (const r of rows) {
    assert.equal(r.color, 'not_evaluated');
    assert.equal(r.value, null);
    assert.equal(r.reason, 'Sin evaluación para este mes');
  }
  assert.equal(rows[1].goal, 'Sin meta mensual para 2027-03');
  assert.equal(rows[1].pace.ok, false);
  assert.match(rows[1].pace.reason, /2027-Q1/);
});

test('mes sin datos: la matriz de un mes no evaluado no mezcla meses', () => {
  const evaluations = [ev(A, null, '2027-01', 'red'), ev(A, VULN.id, '2027-01', 'red')];
  const { rows } = committeeMatrix({ units, indicators: [VULN], evaluations, month: '2027-02' });
  assert.ok(rows.every((r) => r.global === null && r.cells.every((c) => c === null)));
});

test('mes sin datos: elección del mes y opciones del filtro', () => {
  assert.equal(pickMonth(null, [], '2027-03-01'), '2027-02', 'sin evaluaciones -> mes que cierra la mensual');
  assert.equal(pickMonth('2027-03', [], '2027-03-01'), '2027-03', 'el mes en curso siempre es elegible');
  assert.equal(pickMonth('2027-13', ['2027-01'], '2027-03-01'), '2027-01', 'mes inválido -> el último evaluado');
  assert.deepEqual(monthOptions([], '2027-03-01'), ['2027-03']);
});

// ---------------------------------------------------------------- not_evaluated
test('indicador not_evaluated (mínimo de muestra no alcanzado) se muestra como "Sin evaluar" con su motivo', () => {
  const reason = 'Muestra insuficiente: 1 de 3';
  const evaluations = [ev(A, INC.id, '2027-02', 'not_evaluated', { reason })];
  const [inc] = leaderIndicatorRows({
    unitId: A, indicators: [INC], evaluations, targets: [], commitments: [], measurements: [],
    month: '2027-02', today: '2027-03-05',
  });
  assert.equal(inc.color, 'not_evaluated');
  assert.equal(inc.reason, reason, 'conserva el motivo del motor, no el genérico');
  assert.equal(colorLabel(inc.color), 'Sin evaluar');
  assert.equal(colorKey(inc.color), 'not_evaluated');
  const { rows } = committeeMatrix({ units: [units[1]], indicators: [INC], evaluations, month: '2027-02' });
  assert.equal(rows[0].cells[0].color, 'not_evaluated', 'la celda existe (evaluada como sin evaluar), no es vacía');
});

test('evaluación con color nulo se trata como sin evaluar', () => {
  const [inc] = leaderIndicatorRows({
    unitId: A, indicators: [INC], evaluations: [ev(A, INC.id, '2027-02', null)], targets: [], commitments: [],
    measurements: [], month: '2027-02', today: '2027-03-05',
  });
  assert.equal(inc.color, 'not_evaluated');
  assert.equal(colorLabel(null), 'Sin evaluar');
  assert.equal(colorKey('purple'), 'not_evaluated');
});

test('meta de un indicador de sentido inverso usa ≤', () => {
  const [inc] = leaderIndicatorRows({
    unitId: A, indicators: [INC], evaluations: [], targets: [], commitments: [], measurements: [],
    month: '2027-02', today: '2027-03-05',
  });
  assert.equal(inc.goal, 'Verde ≤ 5; amarillo ≤ 10');
  assert.equal(inc.pace, null, 'el ritmo solo aplica a cumulative_target');
});

// ---------------------------------------------------------------- V-03: 0 % y 100 %
test('V-03: completitud 0 % cuando ninguna unidad cargó el mes; faltan todas', () => {
  const g = completeness({ indicators: [VULN], units, measurements: [], month: '2027-02' });
  assert.equal(g.length, 1);
  assert.equal(g[0].pct, 0);
  assert.equal(g[0].loaded, 0);
  assert.equal(g[0].total, 3);
  assert.deepEqual(g[0].items[0].missing, ['Unidad Alfa', 'Unidad Beta', 'Unidad Gamma']);
});

test('V-03: completitud 100 % con cargas en el primer y el último día del mes', () => {
  const measurements = [
    { unit_id: A, indicator_id: VULN.id, measured_on: '2027-02-01' },
    { unit_id: B, indicator_id: VULN.id, measured_on: '2027-02-28' },
    { unit_id: C, indicator_id: VULN.id, measured_on: '2027-02-14' },
  ];
  const [g] = completeness({ indicators: [VULN], units, measurements, month: '2027-02' });
  assert.equal(g.pct, 100);
  assert.deepEqual(g.items[0].missing, []);
});

test('V-03: cargas fuera del mes (día anterior y posterior) no cuentan', () => {
  const measurements = [
    { unit_id: A, indicator_id: VULN.id, measured_on: '2027-01-31' },
    { unit_id: B, indicator_id: VULN.id, measured_on: '2027-03-01' },
    { unit_id: C, indicator_id: VULN.id, measured_on: null },
  ];
  const [g] = completeness({ indicators: [VULN], units, measurements, month: '2027-02' });
  assert.equal(g.pct, 0);
});

test('V-03: % por custodio agrega sus KPI; redondeo; inactivos fuera', () => {
  const VULN2 = { ...VULN, id: 'i-vuln2', code: 'VULN2' };
  const OFF = { ...VULN, id: 'i-off', code: 'OFF', active: false };
  const measurements = [
    { unit_id: A, indicator_id: VULN.id, measured_on: '2027-02-03' },
    { unit_id: A, indicator_id: VULN.id, measured_on: '2027-02-04' }, // duplicado: no cuenta dos veces
    { unit_id: A, indicator_id: INC.id, measured_on: '2027-02-03' },
    { unit_id: B, indicator_id: INC.id, measured_on: '2027-02-03' },
  ];
  const custodians = [{ userId: 'cust-1', label: 'Custodio Uno' }, { userId: 'cust-2', label: 'Custodio Dos' }];
  const groups = completeness({ indicators: [VULN, VULN2, INC, OFF], units, measurements, month: '2027-02', custodians });
  const one = groups.find((g) => g.custodianId === 'cust-1');
  const two = groups.find((g) => g.custodianId === 'cust-2');
  assert.deepEqual(one.items.map((i) => [i.indicator.code, i.pct]), [['VULN', 33], ['VULN2', 0]]);
  assert.deepEqual([one.loaded, one.total, one.pct], [1, 6, 17]);
  assert.deepEqual([two.loaded, two.total, two.pct], [2, 3, 67]);
  assert.ok(!groups.some((g) => g.items.some((i) => i.indicator.code === 'OFF')), 'inactivo no cuenta');
  assert.deepEqual(groups.map((g) => g.custodian), ['Custodio Dos', 'Custodio Uno']);
});

test('V-03: meses del tablero en cambio de año', () => {
  assert.deepEqual(completenessMonths('2027-01-01'), ['2027-01', '2026-12']);
});

// ---------------------------------------------------------------- V-01: varias unidades del líder
test('V-01: líder con varias unidades — cada unidad muestra solo sus datos', () => {
  const evaluations = [
    ev(A, null, '2027-02', 'yellow', { escalation_level: 'restricted', restrictions: ['no_new_change'] }),
    ev(A, VULN.id, '2027-02', 'yellow', { value: 10 }),
    ev(B, null, '2027-02', 'red', { escalation_level: 'frozen', restrictions: ['freeze_all_change'] }),
    ev(B, VULN.id, '2027-02', 'red', { value: 99 }),
  ];
  const targets = [
    { unit_id: A, indicator_id: VULN.id, month: '2027-02', target_value: 100 },
    { unit_id: B, indicator_id: VULN.id, month: '2027-02', target_value: 777 },
  ];
  const commitments = [
    { unit_id: A, indicator_id: VULN.id, period: '2027-Q1', package_by_category: { P0P1: 300, P2P3: 0 } },
    { unit_id: B, indicator_id: VULN.id, period: '2027-Q1', package_by_category: { P0P1: 900, P2P3: 0 } },
  ];
  const measurements = [
    { unit_id: A, indicator_id: VULN.id, measured_on: '2027-02-05', value: 20, category: 'P0P1', kind: 'resolved' },
    { unit_id: B, indicator_id: VULN.id, measured_on: '2027-02-05', value: 500, category: 'P0P1', kind: 'resolved' },
  ];
  const common = { indicators: [VULN], evaluations, targets, commitments, measurements, month: '2027-02', today: '2027-02-15' };
  const [a] = leaderIndicatorRows({ unitId: A, ...common });
  const [b] = leaderIndicatorRows({ unitId: B, ...common });
  assert.deepEqual([a.color, a.value, a.goal], ['yellow', 10, 'Meta acumulada de 2027-02: 100']);
  assert.deepEqual([b.color, b.value, b.goal], ['red', 99, 'Meta acumulada de 2027-02: 777']);
  assert.equal(a.pace.resolved, 20);
  assert.equal(a.pace.effectiveTotal, 300);
  assert.equal(b.pace.resolved, 500);
  assert.equal(b.pace.effectiveTotal, 900);
  assert.deepEqual(unitEvaluation(evaluations, A, '2027-02').restrictions, ['no_new_change']);
  assert.deepEqual(unitEvaluation(evaluations, B, '2027-02').restrictions, ['freeze_all_change']);
});

test('V-01: compromiso del mes prevalece sobre el del trimestre y no se toma el de otra unidad', () => {
  const list = [
    { unit_id: B, indicator_id: INC.id, period: '2027-02', green_override: 1 },
    { unit_id: A, indicator_id: INC.id, period: '2027-Q1', green_override: 4, yellow_override: 8 },
    { unit_id: A, indicator_id: INC.id, period: '2027-02', green_override: 3, yellow_override: 6 },
  ];
  assert.equal(pickCommitment(list, A, INC.id, '2027-02').green_override, 3);
  assert.equal(pickCommitment(list, A, INC.id, '2027-03').green_override, 4);
  assert.equal(pickCommitment(list, C, INC.id, '2027-02'), null);
  const [inc] = leaderIndicatorRows({
    unitId: A, indicators: [INC], evaluations: [], targets: [], commitments: list, measurements: [],
    month: '2027-02', today: '2027-02-15',
  });
  assert.equal(inc.goal, 'Verde ≤ 3; amarillo ≤ 6 (compromiso)');
});

test('V-01: el ritmo no cuenta mediciones posteriores a la fecha de referencia ni de otro trimestre', () => {
  const commitments = [{ unit_id: A, indicator_id: VULN.id, period: '2027-Q1', package_by_category: { P0P1: 100, P2P3: 0 } }];
  const measurements = [
    { unit_id: A, indicator_id: VULN.id, measured_on: '2026-12-31', value: 50, category: 'P0P1', kind: 'resolved' },
    { unit_id: A, indicator_id: VULN.id, measured_on: '2027-02-10', value: 10, category: 'P0P1', kind: 'resolved' },
    { unit_id: A, indicator_id: VULN.id, measured_on: '2027-02-20', value: 30, category: 'P0P1', kind: 'resolved' },
  ];
  const [v] = leaderIndicatorRows({
    unitId: A, indicators: [VULN], evaluations: [], targets: [], commitments, measurements,
    month: '2027-02', today: '2027-02-15',
  });
  assert.equal(v.pace.ok, true);
  assert.equal(v.pace.resolved, 10);
});

test('V-01/V-02: excepción revocada hoy o con fecha inválida no se muestra como vigente', () => {
  const list = [
    { id: 'ok', unit_id: A, scope: 'change_start', expires_on: '2027-02-20' },
    { id: 'rev', unit_id: A, scope: 'all', expires_on: '2027-02-28', revoked_at: '2027-02-15T15:00:00Z' },
    { id: 'bad', unit_id: A, scope: 'all', expires_on: '2027-02-28', revoked_at: 'no-fecha' },
  ];
  assert.deepEqual(activeExceptions(list, '2027-02-15').map((e) => e.id), ['ok']);
});

// ---------------------------------------------------------------- calendario
test('calendario: cambio de año, febrero bisiesto y trimestres', () => {
  assert.equal(addMonths('2027-12', 1), '2028-01');
  assert.equal(addMonths('2027-01', -1), '2026-12');
  assert.equal(addMonths('2027-05', -17), '2025-12');
  assert.equal(monthEnd('2028-02'), '2028-02-29');
  assert.equal(monthEnd('2027-02'), '2027-02-28');
  assert.equal(monthEnd('2027-04'), '2027-04-30');
  assert.deepEqual(quarterBounds('2027-11'), {
    quarter: '2027-Q4', start: '2027-10-01', end: '2027-12-31', months: ['2027-10', '2027-11', '2027-12'],
  });
  assert.throws(() => addMonths('2027-13', 1), TypeError);
  assert.throws(() => monthEnd('2027-2'), TypeError);
  assert.deepEqual(leaderMeasurementsRange('2027-03', '2027-03-10'), { from: '2027-01-01', to: '2027-03-10' });
  assert.deepEqual(leaderMeasurementsRange('2027-12', '2028-01-05'), { from: '2027-10-01', to: '2027-12-31' });
});
