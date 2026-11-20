// QA M-07: "Proponer un tercio" y el color del mes en la pantalla de metas.
// Trazas:
//  - docs/diseno.md, Caso vulnerabilidades: "Meta parcial mensual (aprox. un tercio por mes)".
//  - docs/diseno.md, Modelo de datos: "Metas | Meta parcial mensual (ej. un tercio del paquete)".
//  - plan-maestro M-07: "un indicador pasa de 'Sin evaluar' a color al cargar la meta".
//  - CLAUDE.md 6: "La lógica de cálculo vive en engine/ ... nunca se duplica" (la vista previa
//    de la pantalla debe dar el mismo color que la evaluación mensual de las Actions).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeThirds, proposeThirdTarget, evaluateIndicatorMonth } from '../../engine/index.js';
import { evaluateIndicatorMonth as scriptsEvaluate } from '../../scripts/lib/build.js';
import { targetRows } from '../../src/lib/targets-form.js';

const IND = {
  id: 'i1', code: 'PATCH', active: true, measurement_type: 'cumulative_target', direction: 'higher_is_better',
  window_days: 90, green_threshold: 90, yellow_threshold: 80, thresholds_by_category: {}, frequency: 'monthly',
  min_sample: 0, source: 'manual',
};
const U1 = { id: 'u1', name: 'Unidad Uno' };
const pkg = (period, total, unit = 'u1', indicator = 'i1') => ({ unit_id: unit, indicator_id: indicator, period, package_total: total });
const m = (measured_on, value, extra = {}) => ({ unit_id: 'u1', indicator_id: 'i1', measured_on, value, kind: 'resolved', ...extra });
const tgt = (month, value, unit = 'u1') => ({ id: `t-${unit}-${month}`, unit_id: unit, indicator_id: 'i1', month, target_value: value });
const propose = (commitments, month, unitId = 'u1') => proposeThirdTarget({ commitments, unitId, indicatorId: 'i1', month });
const row = (args) => targetRows({ indicator: IND, units: [U1], commitments: [], targets: [], measurements: [], ...args })[0];

describe('QA M-07 · Proponer un tercio (diseño: aprox. un tercio por mes, acumulado)', () => {
  test('paquete no divisible entre 3: 100 -> 34, 67, 100 (redondeo hacia arriba, el mes 3 es el total)', () => {
    const c = [pkg('2027-Q1', 100)];
    assert.deepEqual(['2027-01', '2027-02', '2027-03'].map((mo) => propose(c, mo).value), [34, 67, 100]);
  });

  test('el mes del trimestre se ubica bien en los cuatro trimestres', () => {
    const c = [pkg('2027-Q1', 30), pkg('2027-Q2', 60), pkg('2027-Q3', 90), pkg('2027-Q4', 120)];
    const cases = {
      '2027-01': 10, '2027-02': 20, '2027-03': 30,
      '2027-04': 20, '2027-05': 40, '2027-06': 60,
      '2027-07': 30, '2027-08': 60, '2027-09': 90,
      '2027-10': 40, '2027-11': 80, '2027-12': 120,
    };
    for (const [mo, v] of Object.entries(cases)) {
      const p = propose(c, mo);
      assert.equal(p.ok, true, mo);
      assert.equal(p.value, v, mo);
    }
  });

  test('para todo paquete entero 0..600: mes1 = ceil(P/3), mes2 = ceil(2P/3), mes3 = P, monótona y nunca supera P', () => {
    for (let P = 0; P <= 600; P++) {
      const [a, b, c] = cumulativeThirds(P);
      assert.equal(a, Math.ceil(P / 3), `P=${P}`);
      assert.equal(b, Math.ceil((2 * P) / 3), `P=${P}`);
      assert.equal(c, P, `P=${P}`);
      assert.ok(a <= b && b <= c, `monótona P=${P}`);
      assert.ok(a - P / 3 < 1 && b - (2 * P) / 3 < 1, `aprox. un tercio P=${P}`);
    }
  });

  test('solo el compromiso trimestral de la misma unidad, indicador y trimestre', () => {
    const c = [pkg('2026-Q3', 999), pkg('2027-Q1', 999), pkg('2026-Q4', 999, 'u2'), pkg('2026-Q4', 999, 'u1', 'i2')];
    const p = propose(c, '2026-10');
    assert.equal(p.ok, false, 'otro trimestre, otra unidad u otro indicador no aplican');
    assert.match(p.reason, /2026-Q4/);
    assert.equal(propose([...c, pkg('2026-Q4', 3)], '2026-10').value, 1);
  });

  test('paquete 0: la propuesta es 0 (no hay nada que resolver)', () => {
    assert.deepEqual(['2026-10', '2026-11', '2026-12'].map((mo) => propose([pkg('2026-Q4', 0)], mo).value), [0, 0, 0]);
  });

  test('paquete con decimales (la BD solo exige >= 0): la meta acumulada nunca supera el paquete', {
    todo: 'H-M07-QA-01: cumulativeThirds(0.5) = [1, 1, 0.5]; el mes 1 propone más que el paquete',
  }, () => {
    for (const P of [0.5, 1.5, 2.4, 10.2]) {
      const [a, b, c] = cumulativeThirds(P);
      assert.ok(a <= b && b <= c && c === P, `P=${P}: ${[a, b, c]}`);
    }
  });
});

describe('QA M-07 · de "Sin evaluar" a color al cargar la meta (vista previa = evaluación mensual)', () => {
  test('sin meta del mes: Sin evaluar; con meta: color', () => {
    const measurements = [m('2026-10-10', 9)];
    assert.equal(row({ measurements, month: '2026-10' }).evaluation.color, 'not_evaluated');
    assert.equal(row({ measurements, targets: [tgt('2026-10', 10)], month: '2026-10' }).evaluation.color, 'green');
  });

  test('umbrales exactos: 90 % verde, 80 % amarillo, 79 % rojo (más es mejor)', () => {
    const color = (v) => row({ measurements: [m('2026-10-10', v)], targets: [tgt('2026-10', 10)], month: '2026-10' }).evaluation;
    assert.equal(color(9).color, 'green');
    assert.equal(color(9).value, 90);
    assert.equal(color(8).color, 'yellow');
    assert.equal(color(7.9).color, 'red');
    assert.equal(color(12).color, 'green', 'resolver más que la meta sigue en verde');
  });

  test('la meta es ACUMULADA del trimestre: el mes 2 suma lo resuelto en los meses 1 y 2', () => {
    const measurements = [m('2026-10-05', 10), m('2026-11-20', 8)];
    const r = row({ measurements, targets: [tgt('2026-11', 20)], month: '2026-11' }).evaluation;
    assert.equal(r.value, 90);
    assert.equal(r.color, 'green');
  });

  test('no cuentan: otro trimestre, después del cierre del mes, otra unidad, otro indicador ni lo no resuelto', () => {
    const measurements = [
      m('2026-09-30', 100), // trimestre anterior
      m('2026-11-01', 100), // después del cierre de octubre
      m('2026-10-10', 100, { unit_id: 'u2' }),
      m('2026-10-10', 100, { indicator_id: 'i2' }),
      m('2026-10-10', 100, { kind: 'new' }),
      m('2026-10-10', 5),
    ];
    const r = row({ measurements, targets: [tgt('2026-10', 10)], month: '2026-10' }).evaluation;
    assert.equal(r.value, 50);
    assert.equal(r.color, 'red');
  });

  test('mínimo de muestra no alcanzado: sigue Sin evaluar aunque haya meta', () => {
    const r = targetRows({
      indicator: { ...IND, min_sample: 2 }, units: [U1], commitments: [], targets: [tgt('2026-10', 10)],
      measurements: [m('2026-10-10', 10)], month: '2026-10',
    })[0].evaluation;
    assert.equal(r.color, 'not_evaluated');
  });

  test('una sola regla: la pantalla da el mismo color que la evaluación de scripts/ (Actions)', () => {
    const measurements = [m('2026-10-01', 4), m('2026-11-15', 3), m('2026-12-31', 2)];
    const commitments = [pkg('2026-Q4', 12), { ...pkg('2026-12', null), green_override: 95, yellow_override: 85 }];
    for (const [month, value] of [['2026-10', 4], ['2026-11', 8], ['2026-12', 12], ['2026-12', 9.5]]) {
      const targets = [tgt(month, value)];
      const screen = targetRows({ indicator: IND, units: [U1], commitments, targets, measurements, month })[0].evaluation;
      const args = {
        indicator: IND, measurements, target: targets[0], evalMonth: month,
        commitment: commitments.find((c) => c.period === month) ?? commitments[0],
        packageCommitment: commitments[0],
      };
      assert.deepEqual(screen, scriptsEvaluate(args), `${month}/${value}`);
      assert.deepEqual(screen, evaluateIndicatorMonth(args), `${month}/${value}`);
    }
  });
});
