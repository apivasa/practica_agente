// Pruebas QA independientes de M-05 (motor de vulnerabilidades).
// Cada caso traza a una frase de docs/diseno.md ("Caso: vulnerabilidades", "Alertas"),
// al criterio de M-05 en docs/plan-maestro.md o a la decisión por defecto Q-06
// en docs/pendientes-usuario.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  packageStatus,
  paceStatus,
  recalculateOnNewCritical,
  DEFAULT_COMPLIANCE_THRESHOLDS,
} from '../../engine/vulnerabilities.js';
import * as engine from '../../engine/index.js';

// Ejemplo del diseño: paquete 2.000 para enero–marzo; entran 200 P0/P1 en meses 1–2 → 2.200.
const Q = { quarterStart: '2026-01-01', quarterEnd: '2026-03-31' };
const PKG = { p0p1: 500, p2p3: 1500 }; // 2.000
const st = (over = {}) => packageStatus({ ...Q, asOf: '2026-01-01', initialPackage: PKG, ...over });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('QA M-05 · superficie pública', () => {
  test('el motor expone las funciones desde engine/index.js', () => {
    assert.equal(typeof engine.packageStatus, 'function');
    assert.equal(typeof engine.paceStatus, 'function');
    assert.equal(typeof engine.recalculateOnNewCritical, 'function');
  });
  test('umbrales por defecto 96 % P0/P1 y 85 % P2/P3', () => {
    assert.deepEqual({ ...DEFAULT_COMPLIANCE_THRESHOLDS }, { p0p1: 96, p2p3: 85 });
  });
});

describe('QA M-05 · "P0 y P1 nuevas entran directo al paquete en meses 1 y 2 (ej. sube a 2.200)"', () => {
  test('sin ingresos el paquete efectivo es 2.000', () => {
    const s = st();
    assert.equal(s.effectiveTotal.total, 2000);
    assert.equal(s.pending.total, 2000);
    assert.equal(s.carryToNextQuarter, 0);
  });
  test('120 P0/P1 en enero + 80 en febrero → 2.200 (P0/P1 700)', () => {
    const s = st({
      asOf: '2026-02-28',
      newCritical: [
        { detectedOn: '2026-01-15', count: 120 },
        { detectedOn: '2026-02-28', count: 80 },
      ],
    });
    assert.equal(s.effectiveTotal.total, 2200);
    assert.equal(s.effectiveTotal.p0p1, 700);
    assert.equal(s.effectiveTotal.p2p3, 1500);
    assert.equal(s.carryToNextQuarter, 0);
  });
  test('límite: último día del mes 2 suma; primer día del mes 3 no', () => {
    const a = st({ asOf: '2026-03-01', newCritical: [{ detectedOn: '2026-02-28', count: 10 }] });
    const b = st({ asOf: '2026-03-01', newCritical: [{ detectedOn: '2026-03-01', count: 10 }] });
    assert.equal(a.effectiveTotal.total, 2010);
    assert.equal(a.carryToNextQuarter, 0);
    assert.equal(b.effectiveTotal.total, 2000);
    assert.equal(b.carryToNextQuarter, 10);
  });
});

describe('QA M-05 · "Las detectadas en el mes 3 pasan al paquete siguiente"', () => {
  test('P0/P1 de marzo no cambian meta ni ritmo y se reportan para el siguiente paquete', () => {
    const before = st({ asOf: '2026-03-10' });
    const after = st({ asOf: '2026-03-10', newCritical: [{ detectedOn: '2026-03-10', count: 30 }] });
    assert.equal(after.effectiveTotal.total, 2000);
    assert.equal(after.expectedWeeklyPace, before.expectedWeeklyPace);
    assert.equal(after.carryToNextQuarter, 30);
    assert.equal(after.pendingCarry, 2000 + 30);
  });
});

describe('QA M-05 · "Cumplimiento por criticidad: 96 % de P0/P1 y 85 % de P2/P3"', () => {
  const comp = (p0, p2, over = {}) =>
    st({
      asOf: '2026-03-31',
      newCritical: [{ detectedOn: '2026-01-20', count: 200 }], // P0/P1 = 700
      resolved: [
        { resolvedOn: '2026-03-31', criticality: 'P0P1', count: p0 },
        { resolvedOn: '2026-03-31', criticality: 'P2P3', count: p2 },
      ],
      ...over,
    }).compliance;
  test('justo en el límite cumple: 672/700 = 96 % y 1.275/1.500 = 85 %', () => {
    const c = comp(672, 1275);
    near(c.p0p1Pct, 96);
    near(c.p2p3Pct, 85);
    assert.equal(c.meetsP0P1, true);
    assert.equal(c.meetsP2P3, true);
  });
  test('una menos que el límite no cumple: 671/700 y 1.274/1.500', () => {
    const c = comp(671, 1274);
    assert.equal(c.meetsP0P1, false);
    assert.equal(c.meetsP2P3, false);
  });
  test('criticidades independientes: cumplir P2/P3 no compensa P0/P1', () => {
    const c = comp(0, 1500);
    assert.equal(c.meetsP0P1, false);
    assert.equal(c.meetsP2P3, true);
  });
  test('el denominador P0/P1 incluye las ingresadas en meses 1–2 (672/500 no es 134 %)', () => {
    const c = comp(500, 1500);
    near(c.p0p1Pct, (500 * 100) / 700);
    assert.equal(c.meetsP0P1, false);
  });
  test('Q-06: P0/P1 resueltas en el mes 3 cuentan para el trimestre actual', () => {
    const c = comp(700, 1500);
    near(c.p0p1Pct, 100);
    assert.equal(c.meetsP0P1, true);
  });
  test('sobre-resolución no supera 100 %', () => {
    const c = comp(800, 1600);
    assert.equal(c.p0p1Pct, 100);
    assert.equal(c.p2p3Pct, 100);
  });
  test('umbrales configurables por la negociación del custodio', () => {
    const c = comp(630, 1275, { thresholds: { p0p1: 90 } });
    assert.equal(c.meetsP0P1, true); // 90 %
    assert.equal(c.thresholds.p2p3, 85);
  });
});

describe('QA M-05 · "Ritmo esperado: pendiente / semanas restantes, recalculado cada vez que entra algo"', () => {
  test('inicio del trimestre: 2.000 / (89 días / 7)', () => {
    const s = st();
    near(s.weeksRemaining, 89 / 7);
    near(s.expectedWeeklyPace, 2000 / (89 / 7));
  });
  test('Q-06: ritmo contra el 100 % del pendiente (incluye P0/P1 y P2/P3)', () => {
    const s = st({
      asOf: '2026-02-01',
      resolved: [
        { resolvedOn: '2026-01-31', criticality: 'P0P1', count: 300 },
        { resolvedOn: '2026-01-31', criticality: 'P2P3', count: 300 },
      ],
    });
    assert.equal(s.pending.total, 1400);
    near(s.expectedWeeklyPace, 1400 / (58 / 7));
  });
  test('ingreso de 200 P0/P1 el 2026-02-10 sube el ritmo con la misma fecha', () => {
    const a = st({ asOf: '2026-02-10' });
    const b = st({ asOf: '2026-02-10', newCritical: [{ detectedOn: '2026-02-10', count: 200 }] });
    near(a.expectedWeeklyPace, 2000 / (49 / 7));
    near(b.expectedWeeklyPace, 2200 / (49 / 7));
    assert.ok(b.expectedWeeklyPace > a.expectedWeeklyPace);
  });
  test('último día del trimestre: 0 semanas, el ritmo es todo el pendiente (sin división por 0)', () => {
    const s = st({ asOf: '2026-03-31' });
    assert.equal(s.weeksRemaining, 0);
    assert.equal(s.expectedWeeklyPace, 2000);
    assert.ok(Number.isFinite(s.expectedWeeklyPace));
  });
  test('pendiente 0 → ritmo 0', () => {
    const s = st({
      asOf: '2026-02-01',
      resolved: [
        { resolvedOn: '2026-01-31', criticality: 'P0P1', count: 500 },
        { resolvedOn: '2026-01-31', criticality: 'P2P3', count: 1500 },
      ],
    });
    assert.equal(s.expectedWeeklyPace, 0);
  });
});

describe('QA M-05 · "Meta parcial mensual (aprox. un tercio por mes)"', () => {
  test('2.000 → metas acumuladas ≈ 667 / 1.334 / 2.000', () => {
    const t = st().monthlyTargets;
    assert.deepEqual(t.map((x) => x.month), ['2026-01', '2026-02', '2026-03']);
    assert.deepEqual(t.map((x) => x.cumulativeTarget), [667, 1334, 2000]);
  });
  test('2.200 → metas acumuladas ≈ 734 / 1.467 / 2.200 (recalculada)', () => {
    const t = st({ asOf: '2026-02-10', newCritical: [{ detectedOn: '2026-02-10', count: 200 }] }).monthlyTargets;
    assert.deepEqual(t.map((x) => x.cumulativeTarget), [734, 1467, 2200]);
  });
  test('divisible exacto sin redondeo espurio: 2.100 → 700 / 1.400 / 2.100', () => {
    const t = st({ initialPackage: { p0p1: 600, p2p3: 1500 } }).monthlyTargets;
    assert.deepEqual(t.map((x) => x.cumulativeTarget), [700, 1400, 2100]);
  });
  test('cada tramo mensual difiere de un tercio en menos de 1', () => {
    for (const total of [1, 2, 1000, 2000, 2200, 3001]) {
      const t = st({ initialPackage: { p0p1: total, p2p3: 0 } }).monthlyTargets.map((x) => x.cumulativeTarget);
      const steps = [t[0], t[1] - t[0], t[2] - t[1]];
      steps.forEach((s) => assert.ok(Math.abs(s - total / 3) < 1 + 1e-9, `${total}: ${steps}`));
      assert.equal(t[2], total);
    }
  });
  test('trimestre que cruza año (nov–ene) etiqueta los meses bien', () => {
    const s = packageStatus({
      quarterStart: '2026-11-01',
      quarterEnd: '2027-01-31',
      asOf: '2026-12-15',
      initialPackage: PKG,
    });
    assert.deepEqual(s.monthlyTargets.map((x) => x.month), ['2026-11', '2026-12', '2027-01']);
    assert.equal(s.currentMonthIndex, 2);
  });
});

describe('QA M-05 · "Lo no resuelto al cierre se suma al paquete siguiente"', () => {
  test('cierre con 2.200 y 1.900 resueltas + 50 P0/P1 de marzo → arrastre 350', () => {
    const s = st({
      asOf: '2026-03-31',
      newCritical: [
        { detectedOn: '2026-01-10', count: 200 },
        { detectedOn: '2026-03-05', count: 50 },
      ],
      resolved: [
        { resolvedOn: '2026-02-01', criticality: 'P0P1', count: 650 },
        { resolvedOn: '2026-03-20', criticality: 'P2P3', count: 1250 },
      ],
    });
    assert.equal(s.pending.total, 300);
    assert.equal(s.pendingCarry, 350);
  });
  test('todo resuelto y sin ingresos de marzo → arrastre 0', () => {
    const s = st({
      asOf: '2026-04-02',
      resolved: [
        { resolvedOn: '2026-03-31', criticality: 'P0P1', count: 500 },
        { resolvedOn: '2026-03-31', criticality: 'P2P3', count: 1500 },
      ],
    });
    assert.equal(s.pendingCarry, 0);
    assert.equal(s.currentMonthIndex, null);
  });
  test('excedente de P2/P3 no tapa pendientes de P0/P1 en el arrastre', () => {
    const s = st({
      asOf: '2026-03-31',
      resolved: [
        { resolvedOn: '2026-03-31', criticality: 'P0P1', count: 400 },
        { resolvedOn: '2026-03-31', criticality: 'P2P3', count: 1600 },
      ],
    });
    assert.equal(s.pending.p0p1, 100);
    assert.equal(s.pendingCarry, 100);
  });
  test('Q-06 + arrastre: una P0/P1 de marzo ya resuelta no se arrastra como pendiente', () => {
    // 500 P0/P1 del paquete + 10 de marzo; se resuelven las 510 dentro del trimestre.
    // Q-06 las cuenta para el cumplimiento actual; "lo no resuelto" se arrastra → nada.
    const s = st({
      asOf: '2026-03-31',
      newCritical: [{ detectedOn: '2026-03-05', count: 10 }],
      resolved: [
        { resolvedOn: '2026-03-30', criticality: 'P0P1', count: 510 },
        { resolvedOn: '2026-03-30', criticality: 'P2P3', count: 1500 },
      ],
    });
    assert.equal(s.pendingCarry, 0);
  });
});

describe('QA M-05 · Alerta "atraso frente al ritmo esperado" (Q-06: prorrateo por días)', () => {
  const at = (asOf, resolvedCount, newCritical = []) =>
    paceStatus(
      st({
        asOf,
        newCritical,
        resolved: resolvedCount ? [{ resolvedOn: asOf, criticality: 'P2P3', count: resolvedCount }] : [],
      }),
    );
  test('día 10 de enero (31 días): esperado ceil(667·10/31) = 216; 216 al día, 215 atraso de 1', () => {
    const ok = at('2026-01-10', 216);
    const late = at('2026-01-10', 215);
    assert.equal(ok.expected, 216);
    assert.equal(ok.behind, false);
    assert.equal(late.behind, true);
    assert.equal(late.gap, 1);
    assert.match(late.reason, /Atraso/);
  });
  test('día 14 de febrero (28 días): 667 + 667·14/28 → 1.001', () => {
    const r = at('2026-02-14', 1000);
    assert.equal(r.expected, 1001);
    assert.equal(r.gap, 1);
  });
  test('tras ingresar 200 P0/P1, el esperado sube y quien iba al día queda atrasado', () => {
    const before = at('2026-02-14', 1001);
    const after = at('2026-02-14', 1001, [{ detectedOn: '2026-02-14', count: 200 }]);
    assert.equal(before.behind, false);
    assert.equal(after.expected, Math.ceil(734 + (1467 - 734) * 0.5));
    assert.equal(after.behind, true);
  });
  test('sin prorrateo exige la meta acumulada completa del mes', () => {
    const s = st({ asOf: '2026-01-10', resolved: [{ resolvedOn: '2026-01-10', criticality: 'P0P1', count: 300 }] });
    const r = paceStatus(s, { monthToDate: false });
    assert.equal(r.expected, 667);
    assert.equal(r.gap, 367);
  });
  test('último día del mes exige la meta acumulada completa', () => {
    assert.equal(at('2026-03-31', 0).expected, 2000);
    assert.equal(at('2026-01-31', 0).expected, 667);
  });
  test('posterior al trimestre: se exige el total efectivo', () => {
    const r = paceStatus(st({ asOf: '2026-04-05' }));
    assert.equal(r.expected, 2000);
    assert.equal(r.behind, true);
  });
  test('rechaza un estado que no viene de packageStatus', () => {
    assert.throws(() => paceStatus({}), TypeError);
    assert.throws(() => paceStatus(null), TypeError);
  });
});

describe('QA M-05 · Alerta "ingreso de P0/P1 que recalcula la meta"', () => {
  test('2.000 → 2.200: targetChanged, delta 200 y ritmo nuevo mayor', () => {
    const prev = st({ asOf: '2026-02-10' });
    const next = st({ asOf: '2026-02-10', newCritical: [{ detectedOn: '2026-02-10', count: 200 }] });
    const r = recalculateOnNewCritical(prev, next);
    assert.equal(r.targetChanged, true);
    assert.equal(r.delta, 200);
    assert.equal(r.previousTotal, 2000);
    assert.equal(r.newTotal, 2200);
    assert.ok(r.newPace > r.previousPace);
    assert.match(r.reason, /2000.*2200/);
  });
  test('ingreso en el mes 3: no recalcula la meta, informa paso al paquete siguiente', () => {
    const prev = st({ asOf: '2026-03-10' });
    const next = st({ asOf: '2026-03-10', newCritical: [{ detectedOn: '2026-03-10', count: 15 }] });
    const r = recalculateOnNewCritical(prev, next);
    assert.equal(r.targetChanged, false);
    assert.equal(r.delta, 0);
    assert.equal(r.carryDelta, 15);
    assert.match(r.reason, /siguiente/);
  });
  test('sin ingresos: sin cambios', () => {
    const r = recalculateOnNewCritical(st(), st());
    assert.equal(r.targetChanged, false);
    assert.equal(r.carryDelta, 0);
  });
  test('rechaza entradas inválidas', () => {
    assert.throws(() => recalculateOnNewCritical(st(), {}), TypeError);
    assert.throws(() => recalculateOnNewCritical(undefined, st()), TypeError);
  });
});

describe('QA M-05 · errores de entrada', () => {
  test('trimestre que no abarca tres meses', () => {
    assert.throws(() => st({ quarterEnd: '2026-02-28' }), RangeError);
    assert.throws(() => st({ quarterEnd: '2026-04-30' }), RangeError);
  });
  test('asOf anterior al trimestre o fecha inválida', () => {
    assert.throws(() => st({ asOf: '2025-12-31' }), RangeError);
    assert.throws(() => st({ asOf: '2026-02-30' }), TypeError);
  });
  test('detección o resolución fuera del trimestre o futura', () => {
    assert.throws(() => st({ asOf: '2026-02-01', newCritical: [{ detectedOn: '2026-02-02', count: 1 }] }), RangeError);
    assert.throws(() => st({ newCritical: [{ detectedOn: '2025-12-31', count: 1 }] }), RangeError);
  });
  test('conteos negativos, decimales o criticidad desconocida', () => {
    assert.throws(() => st({ initialPackage: { p0p1: -1, p2p3: 0 } }), TypeError);
    assert.throws(() => st({ newCritical: [{ detectedOn: '2026-01-01', count: 1.5 }] }), TypeError);
    assert.throws(
      () => st({ resolved: [{ resolvedOn: '2026-01-01', criticality: 'P4', count: 1 }] }),
      TypeError,
    );
  });
  test('umbral fuera de 0–100 o falta paquete', () => {
    assert.throws(() => st({ thresholds: { p0p1: 101 } }), TypeError);
    assert.throws(() => st({ initialPackage: undefined }), TypeError);
    assert.throws(() => packageStatus(null), TypeError);
  });
});
