import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  packageStatus,
  paceStatus,
  recalculateOnNewCritical,
  DEFAULT_COMPLIANCE_THRESHOLDS,
} from '../../engine/index.js';

// Ejemplo del diseño: paquete 2.000 (200 P0/P1 + 1.800 P2/P3) para enero–marzo.
const base = {
  quarterStart: '2026-01-01',
  quarterEnd: '2026-03-31',
  asOf: '2026-03-31',
  initialPackage: { p0p1: 200, p2p3: 1800 },
};
const crit = [
  { detectedOn: '2026-01-15', count: 120 },
  { detectedOn: '2026-02-10', count: 80 },
  { detectedOn: '2026-03-05', count: 50 },
];
const s = (over = {}) => packageStatus({ ...base, ...over });

describe('packageStatus: ejemplo del diseño (2.000 → 2.200)', () => {
  test('P0/P1 de meses 1–2 suben el paquete a 2.200; las del mes 3 pasan al siguiente trimestre', () => {
    const r = s({ newCritical: crit });
    assert.deepEqual(r.effectiveTotal, { p0p1: 400, p2p3: 1800, total: 2200 });
    assert.equal(r.carryToNextQuarter, 50);
    assert.deepEqual(r.pending, { p0p1: 400, p2p3: 1800, total: 2200 });
    assert.equal(r.pendingCarry, 2250);
  });

  test('metas mensuales ≈ 1/3 acumuladas, redondeo hacia arriba, último mes = total', () => {
    assert.deepEqual(s().monthlyTargets, [
      { month: '2026-01', cumulativeTarget: 667 },
      { month: '2026-02', cumulativeTarget: 1334 },
      { month: '2026-03', cumulativeTarget: 2000 },
    ]);
    assert.deepEqual(
      s({ newCritical: crit }).monthlyTargets.map((m) => m.cumulativeTarget),
      [734, 1467, 2200],
    );
    // Divisible exacto: sin redondeo espurio por coma flotante.
    assert.deepEqual(
      s({ initialPackage: { p0p1: 0, p2p3: 2100 } }).monthlyTargets.map((m) => m.cumulativeTarget),
      [700, 1400, 2100],
    );
  });

  test('trimestre que cruza el año', () => {
    const r = packageStatus({
      quarterStart: '2026-11-01', quarterEnd: '2027-01-31', asOf: '2026-11-19',
      initialPackage: { p0p1: 3, p2p3: 0 },
    });
    assert.deepEqual(r.monthlyTargets.map((m) => m.month), ['2026-11', '2026-12', '2027-01']);
    assert.equal(r.currentMonthIndex, 1);
  });

  test('ritmo: pendiente / semanas restantes, recalculado al entrar críticas', () => {
    const resolved = [{ resolvedOn: '2026-01-31', criticality: 'P2P3', count: 600 }];
    const before = s({ asOf: '2026-02-03', resolved, newCritical: crit.slice(0, 1) });
    assert.equal(before.weeksRemaining, 8); // 56 días
    assert.equal(before.pending.total, 2120 - 600);
    assert.equal(before.expectedWeeklyPace, 1520 / 8);
    const after = s({
      asOf: '2026-02-10', resolved, newCritical: crit.slice(0, 2),
    });
    assert.equal(after.weeksRemaining, 7);
    assert.equal(after.expectedWeeklyPace, (2200 - 600) / 7);
    const rec = recalculateOnNewCritical(before, after);
    assert.equal(rec.targetChanged, true);
    assert.equal(rec.delta, 80);
    assert.equal(rec.previousTotal, 2120);
    assert.equal(rec.newTotal, 2200);
    assert.match(rec.reason, /Ingresaron 80 P0\/P1: la meta del trimestre pasa de 2120 a 2200; ritmo esperado de 190 a 228.57/);
  });

  test('semanas restantes 0 en el último día: ritmo = pendiente', () => {
    const r = s({ newCritical: crit });
    assert.equal(r.weeksRemaining, 0);
    assert.equal(r.expectedWeeklyPace, 2200);
    assert.equal(r.currentMonthIndex, 3);
  });

  test('asOf después del trimestre: semanas 0, mes en curso null', () => {
    const r = s({ asOf: '2026-04-15', newCritical: crit });
    assert.equal(r.weeksRemaining, 0);
    assert.equal(r.currentMonthIndex, null);
    assert.equal(r.carryToNextQuarter, 50);
  });

  test('asOf en el primer día: semanas con decimales', () => {
    assert.equal(s({ asOf: '2026-01-01' }).weeksRemaining, 89 / 7);
  });
});

describe('cumplimiento por criticidad', () => {
  const res = (p0, p2) => [
    { resolvedOn: '2026-02-01', criticality: 'P0P1', count: p0 },
    { resolvedOn: '2026-03-01', criticality: 'P2P3', count: p2 },
  ];
  test('96 % y 85 % exactos cumplen (límite)', () => {
    const r = s({ newCritical: crit, resolved: res(384, 1530) });
    assert.equal(r.compliance.p0p1Pct, 96);
    assert.equal(r.compliance.p2p3Pct, 85);
    assert.equal(r.compliance.meetsP0P1, true);
    assert.equal(r.compliance.meetsP2P3, true);
    assert.deepEqual(r.compliance.thresholds, DEFAULT_COMPLIANCE_THRESHOLDS);
  });
  test('una menos no cumple', () => {
    const r = s({ newCritical: crit, resolved: res(383, 1529) });
    assert.equal(r.compliance.meetsP0P1, false);
    assert.equal(r.compliance.meetsP2P3, false);
  });
  test('tolerancia de coma flotante en el umbral', () => {
    // 29/30 = 96.666…; umbral configurado con el mismo valor calculado de otra forma.
    const r = s({
      initialPackage: { p0p1: 30, p2p3: 0 },
      resolved: [{ resolvedOn: '2026-02-01', criticality: 'P0P1', count: 29 }],
      thresholds: { p0p1: (29 / 30) * 100 + 1e-12 },
    });
    assert.equal(r.compliance.meetsP0P1, true);
  });
  test('umbrales configurables', () => {
    const r = s({ newCritical: crit, resolved: res(384, 1530), thresholds: { p0p1: 97, p2p3: 80 } });
    assert.equal(r.compliance.meetsP0P1, false);
    assert.equal(r.compliance.meetsP2P3, true);
  });
  test('sin nada que resolver = 100 %; excedente no supera 100 % ni deja pendiente negativo', () => {
    const r = s({
      initialPackage: { p0p1: 0, p2p3: 10 },
      resolved: [{ resolvedOn: '2026-02-01', criticality: 'P2P3', count: 12 }],
    });
    assert.equal(r.compliance.p0p1Pct, 100);
    assert.equal(r.compliance.p2p3Pct, 100);
    assert.equal(r.pending.total, 0);
    assert.equal(r.resolvedToDate.total, 10);
    assert.equal(r.resolvedReported.total, 12);
  });
});

describe('paceStatus', () => {
  const resolvedN = (n) => [{ resolvedOn: '2026-01-10', criticality: 'P2P3', count: n }];
  test('mes 1 prorrateado por días', () => {
    // 2.000 → meta enero 667; al 2026-01-15: ceil(667 × 15/31) = 323.
    const p = paceStatus(s({ asOf: '2026-01-15', resolved: resolvedN(300) }));
    assert.equal(p.expected, 323);
    assert.equal(p.behind, true);
    assert.equal(p.gap, 23);
    assert.match(p.reason, /^Atraso/);
    const ok = paceStatus(s({ asOf: '2026-01-15', resolved: resolvedN(323) }));
    assert.equal(ok.behind, false);
    assert.equal(ok.gap, 0);
    assert.match(ok.reason, /^Al día/);
  });
  test('mes 2 prorrateado parte de la meta del mes 1', () => {
    // 667 + (1334-667) × 14/28 = 1000.5 → 1001
    const p = paceStatus(s({ asOf: '2026-02-14', resolved: resolvedN(1000) }));
    assert.equal(p.expected, 1001);
    assert.equal(p.gap, 1);
  });
  test('monthToDate false exige la meta completa del mes', () => {
    const p = paceStatus(s({ asOf: '2026-02-14', resolved: resolvedN(1000) }), { monthToDate: false });
    assert.equal(p.expected, 1334);
    assert.equal(p.gap, 334);
  });
  test('fin de mes = meta acumulada del mes', () => {
    assert.equal(paceStatus(s({ asOf: '2026-01-31' })).expected, 667);
  });
  test('después del trimestre exige el total efectivo', () => {
    const p = paceStatus(s({ asOf: '2026-04-02', newCritical: crit, resolved: resolvedN(1700) }));
    assert.equal(p.expected, 2200);
    assert.equal(p.gap, 500);
    assert.match(p.reason, /cierre del trimestre/);
  });
  test('rechaza un estado que no viene de packageStatus', () => {
    assert.throws(() => paceStatus({}), TypeError);
    assert.throws(() => paceStatus(null), TypeError);
  });
});

describe('H-M05-01: una criticidad no compensa la otra', () => {
  test('exceso de P2/P3 se recorta y el atraso de P0/P1 se ve por criticidad', () => {
    const st = packageStatus({
      quarterStart: '2026-01-01', quarterEnd: '2026-03-31', asOf: '2026-01-31',
      initialPackage: { p0p1: 300, p2p3: 300 },
      resolved: [{ resolvedOn: '2026-01-10', criticality: 'P2P3', count: 500 }],
    });
    assert.deepEqual(st.resolvedToDate, { p0p1: 0, p2p3: 300, total: 300 });
    assert.equal(st.resolvedReported.total, 500);
    assert.deepEqual(st.expectedWeeklyPaceByCriticality, { p0p1: 300 / (59 / 7), p2p3: 0 });
    const p = paceStatus(st);
    assert.equal(p.behind, false); // total: 300 >= 200
    assert.equal(p.behindAny, true);
    assert.deepEqual(p.byCriticality.p0p1, { behind: true, gap: 100, expected: 100, resolved: 0 });
    assert.equal(p.byCriticality.p2p3.behind, false);
    assert.match(p.reason, /Atraso por criticidad: P0\/P1 faltan 100$/);
  });
  test('P2/P3 atrasadas se informan también', () => {
    const st = s({ asOf: '2026-01-31', resolved: [{ resolvedOn: '2026-01-10', criticality: 'P0P1', count: 200 }] });
    const p = paceStatus(st, { monthToDate: false });
    assert.equal(p.byCriticality.p2p3.behind, true);
    assert.equal(p.byCriticality.p0p1.behind, false);
    assert.match(p.reason, /P2\/P3 faltan 600/);
  });
  test('al día en ambas criticidades: sin mención de atraso', () => {
    const p = paceStatus(s({ asOf: '2026-01-31', resolved: [
      { resolvedOn: '2026-01-10', criticality: 'P0P1', count: 67 },
      { resolvedOn: '2026-01-10', criticality: 'P2P3', count: 600 }] }));
    assert.equal(p.behindAny, false);
    assert.equal(p.reason, 'Al día: 667 resueltas frente a 667 esperadas (avance esperado a 2026-01-31, mes 2026-01)');
  });
  test('en el último día el ritmo por criticidad es el pendiente', () => {
    const st = s();
    assert.deepEqual(st.expectedWeeklyPaceByCriticality, { p0p1: 200, p2p3: 1800 });
  });
  test('P0/P1 del mes 3 resueltas no se arrastran (QA H-01)', () => {
    const st = s({
      newCritical: [{ detectedOn: '2026-03-05', count: 50 }],
      resolved: [{ resolvedOn: '2026-03-30', criticality: 'P0P1', count: 230 }],
    });
    assert.equal(st.resolvedToDate.p0p1, 230);
    assert.equal(st.pending.p0p1, 0);
    assert.equal(st.pendingCarry, 20 + 1800);
  });
});

describe('H-M05-02 y H-M05-03', () => {
  test('conteos no seguros se rechazan', () => {
    assert.throws(() => s({ initialPackage: { p0p1: 1e308, p2p3: 0 } }), /entero seguro/);
    assert.throws(() => s({ initialPackage: { p0p1: 2 ** 53, p2p3: 0 } }), TypeError);
  });
  test('sumas que salen del rango seguro se rechazan', () => {
    const big = Number.MAX_SAFE_INTEGER;
    assert.throws(() => s({ initialPackage: { p0p1: big, p2p3: big } }), /effectiveTotal excede/);
    assert.throws(() => s({ initialPackage: { p0p1: big - 1, p2p3: 0 },
      newCritical: [{ detectedOn: '2026-03-01', count: 5 }] }), /mes 3 excede/);
    assert.throws(() => s({ newCritical: [{ detectedOn: '2026-01-02', count: big }, { detectedOn: '2026-01-03', count: 1 }] }), /newCritical excede/);
    assert.throws(() => s({ resolved: [
      { resolvedOn: '2026-01-02', criticality: 'P0P1', count: big },
      { resolvedOn: '2026-01-02', criticality: 'P0P1', count: 1 }] }), /resolved P0\/P1 excede/);
    assert.throws(() => s({ resolved: [
      { resolvedOn: '2026-01-02', criticality: 'P2P3', count: big },
      { resolvedOn: '2026-01-02', criticality: 'P2P3', count: 1 }] }), /resolved P2\/P3 excede/);
    assert.throws(() => s({ resolved: [
      { resolvedOn: '2026-01-02', criticality: 'P0P1', count: big },
      { resolvedOn: '2026-01-02', criticality: 'P2P3', count: 1 }] }), /resolved excede/);
  });
  test('estado con totales no finitos se rechaza', () => {
    const st = s();
    assert.throws(() => paceStatus({ ...st, effectiveTotal: { ...st.effectiveTotal, total: Infinity } }), TypeError);
    assert.throws(() => paceStatus({ ...st, resolvedToDate: { ...st.resolvedToDate, p0p1: NaN } }), TypeError);
    assert.throws(() => paceStatus({ ...st, monthlyTargetsByCriticality: undefined }), TypeError);
  });
  test('umbrales y paquete heredados del prototipo se ignoran', () => {
    const st = s({ thresholds: Object.create({ p0p1: 0, p2p3: 0 }) });
    assert.deepEqual(st.compliance.thresholds, { p0p1: 96, p2p3: 85 });
    assert.throws(() => s({ initialPackage: Object.create({ p0p1: 5, p2p3: 5 }) }), TypeError);
  });
});

describe('recalculateOnNewCritical', () => {
  const a = s({ asOf: '2026-03-01', newCritical: crit.slice(0, 2) });
  test('P0/P1 del mes 3 no cambian la meta', () => {
    const b = s({ asOf: '2026-03-06', newCritical: crit });
    const r = recalculateOnNewCritical(a, b);
    assert.equal(r.targetChanged, false);
    assert.equal(r.delta, 0);
    assert.equal(r.carryDelta, 50);
    assert.match(r.reason, /siguiente trimestre/);
  });
  test('sin cambios', () => {
    const r = recalculateOnNewCritical(a, a);
    assert.equal(r.targetChanged, false);
    assert.equal(r.reason, 'Sin cambios en la meta del trimestre');
  });
  test('baja del total (corrección de datos)', () => {
    const r = recalculateOnNewCritical(a, s({ asOf: '2026-03-01' }));
    assert.equal(r.delta, -200);
    assert.match(r.reason, /^Se retiraron 200/);
  });
  test('valida ambos estados', () => {
    assert.throws(() => recalculateOnNewCritical({}, a), /prevStatus/);
    assert.throws(() => recalculateOnNewCritical(a, { ...a, asOf: 'x' }), /newStatus/);
  });
});

describe('validación de entradas', () => {
  const cases = [
    ['entrada ausente', undefined, TypeError],
    ['quarterStart inválido', { quarterStart: '2026-02-30' }, /quarterStart/],
    ['quarterEnd inválido', { quarterEnd: 'x' }, /quarterEnd/],
    ['asOf inválido', { asOf: '2026-13-01' }, /asOf/],
    ['fin antes de inicio', { quarterEnd: '2025-12-01' }, /anterior a quarterStart/],
    ['no son tres meses', { quarterEnd: '2026-04-30' }, /tres meses/],
    ['asOf antes del trimestre', { asOf: '2025-12-31' }, /asOf no puede ser anterior/],
    ['sin paquete', { initialPackage: null }, /initialPackage es obligatorio/],
    ['conteo no entero', { initialPackage: { p0p1: 1.5, p2p3: 0 } }, /initialPackage.p0p1/],
    ['conteo negativo', { initialPackage: { p0p1: 0, p2p3: -1 } }, /initialPackage.p2p3/],
    ['thresholds null', { thresholds: null }, /thresholds debe ser un objeto/],
    ['umbral fuera de rango', { thresholds: { p0p1: 101 } }, /thresholds.p0p1/],
    ['umbral no numérico', { thresholds: { p2p3: '85' } }, /thresholds.p2p3/],
    ['newCritical no arreglo', { newCritical: {} }, /newCritical debe ser un arreglo/],
    ['newCritical entrada nula', { newCritical: [null] }, /newCritical\[0\] inválido/],
    ['detección fuera del trimestre', { newCritical: [{ detectedOn: '2026-04-01', count: 1 }] }, /fuera del trimestre/],
    ['detección posterior a asOf', { asOf: '2026-01-10', newCritical: [{ detectedOn: '2026-01-11', count: 1 }] }, /posterior a asOf/],
    ['detección conteo inválido', { newCritical: [{ detectedOn: '2026-01-11', count: -2 }] }, /count/],
    ['resolved no arreglo', { resolved: 'x' }, /resolved debe ser un arreglo/],
    ['resolved entrada nula', { resolved: [0] }, /resolved\[0\] inválido/],
    ['resolved fecha inválida', { resolved: [{ resolvedOn: '2026-02-29', criticality: 'P0P1', count: 1 }] }, /resolvedOn/],
    ['criticidad desconocida', { resolved: [{ resolvedOn: '2026-02-01', criticality: 'P4', count: 1 }] }, /criticality/],
    ['resolved conteo inválido', { resolved: [{ resolvedOn: '2026-02-01', criticality: 'P0P1', count: NaN }] }, /count/],
  ];
  for (const [name, over, err] of cases) {
    test(name, () => {
      assert.throws(() => packageStatus(over === undefined ? undefined : { ...base, ...over }), err);
    });
  }
});
