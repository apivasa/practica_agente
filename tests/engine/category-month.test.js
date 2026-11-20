// M-06: color mensual de vulnerabilidades por criticidad (engine/vulnerabilities.js
// categoryMonthColor y engine/rows.js evaluateCategoryMonth). Pruebas del desarrollador.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { packageStatus, categoryMonthColor } from '../../engine/vulnerabilities.js';
import { evaluateCategoryMonth, hasCategoryEvaluation, quarterCommitment } from '../../engine/rows.js';
import { evaluateIndicatorMonth } from '../../scripts/lib/build.js';
import { leaderIndicatorRows, categoryGoal } from '../../src/lib/dashboard.js';

const CFG = {
  measurementType: 'cumulative_target',
  direction: 'higher_is_better',
  windowDays: 90,
  thresholds: { green: 96, yellow: 90 },
  thresholdsByCategory: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
  minSample: 0,
};

/** Estado al cierre de enero 2027 con paquete 300/300 (meta del mes 100/100). */
const status = (p0, p2, { pkg = { p0p1: 300, p2p3: 300 }, asOf = '2027-01-31' } = {}) =>
  packageStatus({
    quarterStart: '2027-01-01',
    quarterEnd: '2027-03-31',
    asOf,
    initialPackage: pkg,
    resolved: [
      { resolvedOn: '2027-01-15', criticality: 'P0P1', count: p0 },
      { resolvedOn: '2027-01-15', criticality: 'P2P3', count: p2 },
    ],
  });
const samples = { sampleSizes: { P0P1: 1, P2P3: 1 } };

describe('categoryMonthColor: tabla de verdad', () => {
  const cases = [
    // [P0/P1 resueltas de 100, P2/P3 resueltas de 100, color esperado]
    [96, 85, 'green'],
    [100, 100, 'green'],
    [95, 100, 'yellow'],
    [89, 100, 'red'],
    [100, 84, 'yellow'],
    [100, 74, 'red'],
    [95, 74, 'red'],
    [90, 75, 'yellow'],
  ];
  for (const [p0, p2, expected] of cases) {
    test(`P0/P1 ${p0} %, P2/P3 ${p2} % → ${expected}`, () => {
      const r = categoryMonthColor(CFG, status(p0, p2), samples);
      assert.equal(r.color, expected);
      assert.equal(r.month, '2027-01');
      assert.equal(r.byCategory.P0P1.target, 100);
      assert.equal(r.byCategory.P2P3.target, 100);
      assert.match(r.reason, /P0\/P1/);
      assert.match(r.reason, /P2\/P3/);
    });
  }

  test('lo alto de una criticidad no compensa la otra (el agregado daría verde)', () => {
    // 95 + 100 = 195 de 200 = 97,5 % agregado; P0/P1 en 95 % no llega a 96.
    const r = categoryMonthColor(CFG, status(95, 100), samples);
    assert.notEqual(r.color, 'green');
    assert.equal(r.byCategory.P0P1.color, 'yellow');
    assert.equal(r.byCategory.P2P3.color, 'green');
    assert.equal(r.value, 95, 'el valor es el de la categoría con peor color');
  });

  test('meta acumulada del mes: 1/3, 2/3 y 3/3 del paquete efectivo', () => {
    const feb = categoryMonthColor(CFG, status(200, 170, { asOf: '2027-02-28' }), samples);
    assert.equal(feb.month, '2027-02');
    assert.equal(feb.byCategory.P0P1.target, 200);
    assert.equal(feb.color, 'green'); // P2/P3 170/200 = 85 %
    const mar = categoryMonthColor(CFG, status(290, 300, { asOf: '2027-03-31' }), samples);
    assert.equal(mar.byCategory.P0P1.target, 300);
    assert.equal(mar.byCategory.P0P1.color, 'green'); // 96,67 %
    const after = categoryMonthColor(CFG, status(290, 300, { asOf: '2027-04-10' }), samples);
    assert.equal(after.month, '2027-03', 'después del trimestre se evalúa el cierre');
  });

  test('P0/P1 nuevas de los meses 1 y 2 suben la meta', () => {
    const st = packageStatus({
      quarterStart: '2027-01-01', quarterEnd: '2027-03-31', asOf: '2027-02-28',
      initialPackage: { p0p1: 1500, p2p3: 500 },
      newCritical: [{ detectedOn: '2027-02-10', count: 200 }],
      resolved: [
        { resolvedOn: '2027-01-31', criticality: 'P0P1', count: 500 },
        { resolvedOn: '2027-02-09', criticality: 'P0P1', count: 550 },
        { resolvedOn: '2027-01-31', criticality: 'P2P3', count: 350 },
      ],
    });
    const r = categoryMonthColor(CFG, st, samples);
    assert.equal(r.byCategory.P0P1.target, 1134);
    assert.equal(r.color, 'yellow');
    assert.ok(Math.abs(r.value - 92.59) < 0.01);
  });

  test('meta 0: la categoría cumple al 100 %', () => {
    const r = categoryMonthColor(CFG, status(96, 0, { pkg: { p0p1: 300, p2p3: 0 } }), samples);
    assert.equal(r.byCategory.P2P3.target, 0);
    assert.equal(r.byCategory.P2P3.value, 100);
    assert.equal(r.byCategory.P2P3.color, 'green');
    assert.equal(r.color, 'green');
  });

  test('categoría sin paquete: sin evaluar con motivo; no oculta un rojo', () => {
    const r = categoryMonthColor(CFG, status(100, 0), { packageCategories: ['P0P1'], ...samples });
    assert.equal(r.byCategory.P2P3.color, 'not_evaluated');
    assert.match(r.byCategory.P2P3.reason, /sin paquete/);
    assert.equal(r.color, 'not_evaluated', 'sin P2/P3 no se puede afirmar verde');
    assert.equal(r.value, null);
    assert.match(r.reason, /^Sin evaluar por criticidad/);
    const red = categoryMonthColor(CFG, status(50, 0), { packageCategories: ['P0P1'], ...samples });
    assert.equal(red.color, 'red', 'un rojo conocido se mantiene');
    const none = categoryMonthColor(CFG, status(0, 0), { packageCategories: [] });
    assert.equal(none.color, 'not_evaluated');
  });

  test('categoría no reconocida y muestra insuficiente', () => {
    const cfg = { ...CFG, thresholdsByCategory: { ...CFG.thresholdsByCategory, P4: { green: 50, yellow: 10 } } };
    const r = categoryMonthColor(cfg, status(100, 100), samples);
    assert.equal(r.byCategory.P4.color, 'not_evaluated');
    assert.match(r.byCategory.P4.reason, /no reconocida/);
    assert.equal(r.color, 'not_evaluated');
    const few = categoryMonthColor({ ...CFG, minSample: 2 }, status(100, 100), samples);
    assert.equal(few.color, 'not_evaluated');
    assert.match(few.reason, /Muestra insuficiente/);
  });

  test('errores del llamador', () => {
    assert.throws(() => categoryMonthColor(CFG, {}), /packageStatus/);
    assert.throws(() => categoryMonthColor({ ...CFG, measurementType: 'coverage' }, status(1, 1)), /cumulative_target/);
    assert.throws(() => categoryMonthColor({ ...CFG, thresholdsByCategory: {} }, status(1, 1)), /thresholdsByCategory/);
  });
});

const VULN = {
  id: 'v', code: 'VULN', measurement_type: 'cumulative_target', direction: 'higher_is_better', window_days: 90,
  green_threshold: 96, yellow_threshold: 90,
  thresholds_by_category: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
  frequency: 'monthly', min_sample: 0, source: 'manual',
};
const PKG = { unit_id: 'u', indicator_id: 'v', period: '2027-Q1', package_by_category: { P0P1: 1500, P2P3: 500 } };
const rows = [
  { unit_id: 'u', indicator_id: 'v', measured_on: '2026-12-20', value: 999, category: 'P0P1', kind: 'resolved' },
  { unit_id: 'u', indicator_id: 'v', measured_on: '2027-01-31', value: 500, category: 'P0P1', kind: 'resolved' },
  { unit_id: 'u', indicator_id: 'v', measured_on: '2027-01-31', value: 250, category: 'P2P3', kind: 'resolved' },
  { unit_id: 'u', indicator_id: 'v', measured_on: '2027-02-09', value: 550, category: 'P0P1', kind: 'resolved' },
  { unit_id: 'u', indicator_id: 'v', measured_on: '2027-02-09', value: 100, category: 'P2P3', kind: 'resolved' },
  { unit_id: 'u', indicator_id: 'v', measured_on: '2027-02-10', value: 200, category: 'P0P1', kind: 'detected' },
];

describe('evaluateCategoryMonth (filas de la BD)', () => {
  test('hasCategoryEvaluation solo con meta acumulada y categorías', () => {
    assert.equal(hasCategoryEvaluation(VULN), true);
    assert.equal(hasCategoryEvaluation({ ...VULN, thresholds_by_category: {} }), false);
    assert.equal(hasCategoryEvaluation({ ...VULN, thresholds_by_category: null }), false);
    assert.equal(hasCategoryEvaluation({ ...VULN, measurement_type: 'coverage' }), false);
  });

  test('cierre de enero y de febrero con la semilla 2027-Q1 de Alfa', () => {
    const jan = evaluateCategoryMonth({ indicator: VULN, commitment: PKG, measurements: rows, month: '2027-01' });
    assert.equal(jan.color, 'green');
    assert.equal(jan.byCategory.P0P1.resolved, 500, 'no cuenta lo del trimestre anterior ni lo posterior al mes');
    const feb = evaluateCategoryMonth({ indicator: VULN, commitment: PKG, measurements: rows, month: '2027-02' });
    assert.equal(feb.color, 'yellow');
    assert.equal(feb.byCategory.P0P1.target, 1134);
    assert.equal(feb.sampleSize, 4);
  });

  test('sin compromiso o sin paquete: sin evaluar con motivo; datos inválidos no lanzan', () => {
    const none = evaluateCategoryMonth({ indicator: VULN, commitment: null, measurements: rows, month: '2027-01' });
    assert.equal(none.color, 'not_evaluated');
    assert.match(none.reason, /Sin paquete por criticidad/);
    const half = evaluateCategoryMonth({
      indicator: VULN, commitment: { package_by_category: { P0P1: 1500 } }, measurements: rows, month: '2027-01',
    });
    assert.equal(half.byCategory.P2P3.color, 'not_evaluated');
    assert.equal(half.color, 'not_evaluated');
    const bad = evaluateCategoryMonth({
      indicator: VULN, commitment: PKG, month: '2027-01',
      measurements: [{ measured_on: '2027-01-02', value: 1, category: null, kind: 'resolved' }],
    });
    // H-M06-01: la fila sin categoría se descarta; el mes se evalúa con lo demás (0 resueltas → rojo).
    assert.equal(bad.color, 'red');
    assert.match(bad.reason, /1 medición\(es\) descartada\(s\)/);
  });

  test('quarterCommitment ignora el compromiso mensual', () => {
    const cs = [{ ...PKG, period: '2027-02', package_by_category: null }, PKG];
    assert.equal(quarterCommitment(cs, 'u', 'v', '2027-02'), PKG);
    assert.equal(quarterCommitment(cs, 'u', 'v', '2027-04'), null);
  });
});

describe('integración con build.js y dashboard.js', () => {
  test('evaluateIndicatorMonth usa la ruta por criticidad e ignora targets', () => {
    const r = evaluateIndicatorMonth({
      indicator: VULN, commitment: PKG, measurements: rows, target: { target_value: 1 }, evalMonth: '2027-02',
    });
    assert.equal(r.color, 'yellow');
    assert.match(r.reason, /Por criticidad/);
    const monthly = { ...PKG, period: '2027-02', package_by_category: null, green_override: 50, yellow_override: 10 };
    const viaQuarter = evaluateIndicatorMonth({
      indicator: VULN, commitment: monthly, packageCommitment: PKG, measurements: rows, evalMonth: '2027-02',
    });
    assert.equal(viaQuarter.color, 'yellow', 'el paquete sale del compromiso trimestral');
  });

  test('sin categorías sigue la meta de targets', () => {
    const plain = { ...VULN, thresholds_by_category: {} };
    const r = evaluateIndicatorMonth({ indicator: plain, measurements: rows, target: { target_value: 1000 }, evalMonth: '2027-01' });
    assert.equal(r.value, 75);
    assert.equal(r.color, 'red');
  });

  test('el líder ve la meta del mes por criticidad', () => {
    assert.equal(
      categoryGoal({ indicator: VULN, commitment: PKG, measurements: rows, month: '2027-02' }),
      'Meta acumulada de 2027-02: P0/P1 1134 · P2/P3 334',
    );
    assert.equal(categoryGoal({ indicator: VULN, commitment: null, measurements: [], month: '2027-02' }), 'Sin meta mensual para 2027-02');
    const [row] = leaderIndicatorRows({
      unitId: 'u', indicators: [VULN], evaluations: [], targets: [{ unit_id: 'u', indicator_id: 'v', month: '2027-01', target_value: 9 }],
      commitments: [PKG], measurements: rows, month: '2027-01', today: '2027-03-01',
    });
    assert.equal(row.goal, 'Meta acumulada de 2027-01: P0/P1 500 · P2/P3 167');
  });
});
