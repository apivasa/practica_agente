// M-06 (QA): color mensual de vulnerabilidades por criticidad.
// Cada prueba traza a docs/diseno.md "Caso: vulnerabilidades" o al criterio de M-06 en
// docs/plan-maestro.md: "96 % P0/P1, 85 % P2/P3", "meta parcial mensual (aprox. un tercio por
// mes)", "P0 y P1 nuevas entran directo al paquete en meses 1 y 2; las del mes 3 pasan al
// siguiente", "peor color", "meta 0", "categoría sin paquete = sin evaluar", "sin targets".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { categoryMonthColor, packageStatus } from '../../engine/vulnerabilities.js';
import { evaluateCategoryMonth } from '../../engine/rows.js';
import * as engine from '../../engine/index.js';
import { evaluateIndicatorMonth } from '../../scripts/lib/build.js';
import { categoryGoal } from '../../src/lib/dashboard.js';
import { runMonthly } from '../../scripts/lib/run.js';
import { createFakeDb, seedScenario, IDS } from '../scripts/fake-db.js';

const VULN = {
  id: 'v', code: 'VULN', measurement_type: 'cumulative_target', direction: 'higher_is_better', window_days: 90,
  green_threshold: 96, yellow_threshold: 90,
  thresholds_by_category: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
  frequency: 'monthly', min_sample: 0, source: 'manual',
};
const pkg = (P0P1, P2P3, period = '2027-Q1') => ({ unit_id: 'u', indicator_id: 'v', period, package_by_category: { P0P1, P2P3 } });
const res = (day, category, value) => ({ unit_id: 'u', indicator_id: 'v', measured_on: day, value, category, kind: 'resolved' });
const det = (day, value) => ({ unit_id: 'u', indicator_id: 'v', measured_on: day, value, category: 'P0P1', kind: 'detected' });
const evalMonth = (commitment, measurements, month = '2027-01', indicator = VULN) =>
  evaluateCategoryMonth({ indicator, commitment, measurements, month });

describe('QA M-06: umbrales exactos por criticidad (96 % P0/P1, 85 % P2/P3)', () => {
  // Paquete 7500/7500 → meta de enero 2500/2500: 1 resuelta = 0,04 %.
  const P = pkg(7500, 7500);
  const cases = [
    // [P0/P1 resueltas, P2/P3 resueltas, color P0/P1, color P2/P3, color del indicador]
    [2400, 2125, 'green', 'green', 'green'], // 96,00 y 85,00 exactos
    [2399, 2500, 'yellow', 'green', 'yellow'], // 95,96 % no llega a 96
    [2500, 2124, 'green', 'yellow', 'yellow'], // 84,96 % no llega a 85
    [2250, 2500, 'yellow', 'green', 'yellow'], // 90,00 exacto: amarillo P0/P1
    [2249, 2500, 'red', 'green', 'red'], // 89,96 %
    [2500, 1875, 'green', 'yellow', 'yellow'], // 75,00 exacto: amarillo P2/P3
    [2500, 1874, 'green', 'red', 'red'], // 74,96 %
  ];
  for (const [p0, p2, c0, c2, color] of cases) {
    test(`P0/P1 ${p0}/2500, P2/P3 ${p2}/2500 → ${c0}/${c2} → ${color}`, () => {
      const r = evalMonth(P, [res('2027-01-20', 'P0P1', p0), res('2027-01-20', 'P2P3', p2)]);
      assert.equal(r.byCategory.P0P1.color, c0);
      assert.equal(r.byCategory.P2P3.color, c2);
      assert.equal(r.color, color);
    });
  }

  test('85 % basta para P2/P3 pero no para P0/P1 (cada criticidad con su umbral)', () => {
    const r = evalMonth(P, [res('2027-01-20', 'P0P1', 2125), res('2027-01-20', 'P2P3', 2125)]);
    assert.equal(r.byCategory.P0P1.color, 'red');
    assert.equal(r.byCategory.P2P3.color, 'green');
    assert.equal(r.color, 'red');
  });

  test('lo resuelto de más en P2/P3 no compensa el atraso de P0/P1', () => {
    // Agregado: (2399 + 7500) / 5000 → muy por encima de 96 %; P0/P1 sigue en 95,96 %.
    const r = evalMonth(P, [res('2027-01-20', 'P0P1', 2399), res('2027-01-20', 'P2P3', 7500)]);
    assert.notEqual(r.color, 'green');
  });
});

describe('QA M-06: meta parcial mensual ≈ un tercio (redondeo de 1/3 y 2/3)', () => {
  test('paquete 100: metas 34, 67 y 100 (hacia arriba); 33 de 34 en enero es verde, 32 no', () => {
    const P = pkg(100, 100);
    const jan = evalMonth(P, [res('2027-01-10', 'P0P1', 33), res('2027-01-10', 'P2P3', 34)]);
    assert.equal(jan.byCategory.P0P1.target, 34);
    assert.equal(jan.byCategory.P0P1.color, 'green'); // 97,06 %
    assert.equal(evalMonth(P, [res('2027-01-10', 'P0P1', 32), res('2027-01-10', 'P2P3', 34)]).byCategory.P0P1.color, 'yellow'); // 94,1 %
    const feb = evalMonth(P, [res('2027-01-10', 'P0P1', 65), res('2027-02-10', 'P2P3', 67)], '2027-02');
    assert.equal(feb.byCategory.P0P1.target, 67);
    assert.equal(feb.byCategory.P0P1.color, 'green'); // 65/67 = 97,01 %
    assert.equal(evalMonth(P, [res('2027-01-10', 'P0P1', 64), res('2027-02-10', 'P2P3', 67)], '2027-02').byCategory.P0P1.color, 'yellow'); // 95,5 %
  });

  test('paquete divisible por 3: sin desborde por coma flotante (300 → 100, 200, 300)', () => {
    const P = pkg(300, 3000);
    for (const [month, t0, t2] of [['2027-01', 100, 1000], ['2027-02', 200, 2000], ['2027-03', 300, 3000]]) {
      const r = evalMonth(P, [], month);
      assert.equal(r.byCategory.P0P1.target, t0, month);
      assert.equal(r.byCategory.P2P3.target, t2, month);
    }
  });

  test('P2/P3 500 → 167 y 334 (los valores de la semilla)', () => {
    assert.equal(evalMonth(pkg(1500, 500), []).byCategory.P2P3.target, 167);
    assert.equal(evalMonth(pkg(1500, 500), [], '2027-02').byCategory.P2P3.target, 334);
  });

  test('el mes 3 exige el paquete completo', () => {
    const r = evalMonth(pkg(100, 100), [res('2027-03-31', 'P0P1', 96), res('2027-03-31', 'P2P3', 85)], '2027-03');
    assert.deepEqual([r.byCategory.P0P1.target, r.byCategory.P2P3.target], [100, 100]);
    assert.equal(r.color, 'green');
  });
});

describe('QA M-06: P0/P1 nuevas de los meses 1 y 2 (y no del mes 3)', () => {
  test('detectadas en el mes 1 suben la meta de enero', () => {
    const r = evalMonth(pkg(300, 300), [det('2027-01-05', 30), res('2027-01-31', 'P0P1', 100), res('2027-01-31', 'P2P3', 100)]);
    assert.equal(r.byCategory.P0P1.target, 110);
    assert.equal(r.byCategory.P0P1.color, 'yellow'); // 100/110 = 90,9 %: sin las nuevas sería verde
  });

  test('detectadas en el mes 2 no cambian la meta de enero, sí la de febrero', () => {
    const rows = [det('2027-02-10', 300), res('2027-01-31', 'P0P1', 100), res('2027-01-31', 'P2P3', 100)];
    assert.equal(evalMonth(pkg(300, 300), rows, '2027-01').byCategory.P0P1.target, 100);
    assert.equal(evalMonth(pkg(300, 300), rows, '2027-02').byCategory.P0P1.target, 400); // 2/3 de 600
  });

  test('detectadas en el mes 3 pasan al paquete siguiente: la meta de marzo no cambia', () => {
    const rows = [det('2027-03-05', 300), res('2027-03-20', 'P0P1', 300), res('2027-03-20', 'P2P3', 300)];
    const r = evalMonth(pkg(300, 300), rows, '2027-03');
    assert.equal(r.byCategory.P0P1.target, 300);
    assert.equal(r.color, 'green');
  });

  test('las nuevas solo suben P0/P1, no la meta de P2/P3', () => {
    const r = evalMonth(pkg(300, 300), [det('2027-01-05', 300)]);
    assert.equal(r.byCategory.P2P3.target, 100);
  });
});

describe('QA M-06: peor color y empates', () => {
  test('rojo en una categoría gana a amarillo en la otra', () => {
    const r = evalMonth(pkg(100, 100), [res('2027-01-10', 'P0P1', 32), res('2027-01-10', 'P2P3', 20)]);
    assert.equal(r.byCategory.P0P1.color, 'yellow');
    assert.equal(r.byCategory.P2P3.color, 'red');
    assert.equal(r.color, 'red');
    assert.match(r.reason, /rojo/);
  });

  test('empate de color: el indicador toma ese color y el valor de la categoría más baja', () => {
    // Amarillo / amarillo: P0/P1 31/34 = 91,2 %, P2/P3 27/34 = 79,4 %.
    const y = evalMonth(pkg(100, 100), [res('2027-01-10', 'P0P1', 31), res('2027-01-10', 'P2P3', 27)]);
    assert.deepEqual([y.byCategory.P0P1.color, y.byCategory.P2P3.color, y.color], ['yellow', 'yellow', 'yellow']);
    assert.ok(Math.abs(y.value - (27 * 100) / 34) < 1e-9);
    // Verde / verde: el valor también es el menor (no un promedio).
    const g = evalMonth(pkg(100, 100), [res('2027-01-10', 'P0P1', 34), res('2027-01-10', 'P2P3', 30)]);
    assert.equal(g.color, 'green');
    assert.ok(Math.abs(g.value - (30 * 100) / 34) < 1e-9);
    // Rojo / rojo.
    const r = evalMonth(pkg(100, 100), [res('2027-01-10', 'P0P1', 0), res('2027-01-10', 'P2P3', 10)]);
    assert.equal(r.color, 'red');
    assert.equal(r.value, 0);
  });

  test('el motivo detalla las dos criticidades', () => {
    const r = evalMonth(pkg(100, 100), [res('2027-01-10', 'P0P1', 34), res('2027-01-10', 'P2P3', 30)]);
    assert.match(r.reason, /P0\/P1 .*P2\/P3/);
  });
});

describe('QA M-06: meta 0, sin paquete y categoría desconocida', () => {
  test('meta 0 en ambas categorías (paquete vacío): cumple, verde', () => {
    const r = evalMonth(pkg(0, 0), []);
    assert.equal(r.color, 'green');
    assert.deepEqual([r.byCategory.P0P1.target, r.byCategory.P2P3.target], [0, 0]);
    assert.ok(!Object.is(r.byCategory.P0P1.target, -0));
  });

  test('paquete P0/P1 en 0 pero con nuevas en el mes 2: deja de ser meta 0', () => {
    const r = evalMonth(pkg(0, 0), [det('2027-02-01', 30)], '2027-02');
    assert.equal(r.byCategory.P0P1.target, 20);
    assert.equal(r.color, 'red');
  });

  test('sin compromiso trimestral: sin evaluar, aunque haya mediciones', () => {
    const r = evalMonth(null, [res('2027-01-10', 'P0P1', 100)]);
    assert.equal(r.color, 'not_evaluated');
    assert.equal(r.value, null);
  });

  test('categoría con paquete nulo cuenta como sin paquete (no como meta 0)', () => {
    const r = evalMonth({ period: '2027-Q1', package_by_category: { P0P1: 300, P2P3: null } }, [res('2027-01-10', 'P0P1', 100)]);
    assert.equal(r.byCategory.P2P3.color, 'not_evaluated');
    assert.equal(r.color, 'not_evaluated');
  });

  test('categoría sin paquete no oculta un amarillo conocido', () => {
    const r = evalMonth({ period: '2027-Q1', package_by_category: { P0P1: 300 } }, [res('2027-01-10', 'P0P1', 95)]);
    assert.equal(r.byCategory.P0P1.color, 'yellow');
    assert.equal(r.color, 'yellow');
  });

  test('categoría desconocida en thresholds_by_category: sin evaluar si el resto es verde; no lanza', () => {
    for (const odd of ['P4', 'p0p1', 'constructor', '__proto__']) {
      const tbc = JSON.parse(`{"P0P1":{"green":96,"yellow":90},"P2P3":{"green":85,"yellow":75},"${odd}":{"green":50,"yellow":10}}`);
      const ind = { ...VULN, thresholds_by_category: tbc };
      const r = evalMonth(pkg(300, 300), [res('2027-01-10', 'P0P1', 100), res('2027-01-10', 'P2P3', 100)], '2027-01', ind);
      assert.equal(r.color, 'not_evaluated', odd);
      assert.equal(r.byCategory[odd].color, 'not_evaluated', odd);
    }
  });

  test('categoría desconocida no oculta un rojo conocido', () => {
    const ind = { ...VULN, thresholds_by_category: { ...VULN.thresholds_by_category, P9: { green: 1, yellow: 0 } } };
    const r = evalMonth(pkg(300, 300), [res('2027-01-10', 'P0P1', 10), res('2027-01-10', 'P2P3', 100)], '2027-01', ind);
    assert.equal(r.color, 'red');
  });

  test('medición con categoría fuera de P0P1/P2P3: se descarta (no cuenta), el mes se evalúa y el motivo la menciona', () => {
    // Intento 2 (H-M06-01): una fila inválida ya no anula el mes; 0 de 100 → rojo.
    const r = evalMonth(pkg(300, 300), [res('2027-01-10', 'P9', 10)]);
    assert.equal(r.color, 'red');
    assert.match(r.reason, /1 medición\(es\) descartada\(s\) por categoría o valor inválido/);
  });
});

describe('QA M-06 intento 2: descarte por fila de mediciones malformadas (H-M06-01)', () => {
  const ok = [res('2027-01-10', 'P0P1', 95), res('2027-01-10', 'P2P3', 100)]; // P0/P1 95 % → amarillo
  test('filas resueltas malformadas no suman: no pueden convertir un amarillo en verde', () => {
    for (const bad of [
      res('2027-01-11', 'P0P1', 1.5), res('2027-01-11', 'P0P1', -1), res('2027-01-11', 'p0p1', 5),
      res('2027-01-11', null, 5), res('2027-01-11', '__proto__', 5), res('2027-01-11', 'P0P1', 'abc'),
      res('2027-01-11', 'P0P1', [1]), res('2027-01-11', 'P0P1', true),
    ]) {
      const r = evalMonth(pkg(300, 300), [...ok, bad]);
      assert.equal(r.color, 'yellow', JSON.stringify(bad));
      assert.equal(r.byCategory.P0P1.resolved, 95, JSON.stringify(bad));
      assert.match(r.reason, /1 medición\(es\) descartada\(s\)/, JSON.stringify(bad));
    }
  });

  test('varias filas malformadas: el motivo da el conteo exacto', () => {
    const bads = [res('2027-01-11', 'P9', 1), res('2027-01-12', 'P0P1', 0.5), res('2027-01-13', 'P2P3', -4)];
    const r = evalMonth(pkg(300, 300), [...ok, ...bads]);
    assert.equal(r.color, 'yellow');
    assert.match(r.reason, /3 medición\(es\) descartada\(s\)/);
  });

  test('solo se cuentan las del trimestre hasta el cierre del mes evaluado', () => {
    const r = evalMonth(pkg(300, 300), [...ok, res('2026-12-31', 'P9', 1), res('2027-02-01', 'P9', 1)]);
    assert.doesNotMatch(r.reason, /descartada/);
    const feb = evalMonth(pkg(300, 300), [...ok, res('2027-02-01', 'P9', 1)], '2027-02');
    assert.match(feb.reason, /1 medición\(es\) descartada\(s\)/);
  });

  test('filas válidas no se descartan: texto numérico entero y resuelta sin valor', () => {
    const r = evalMonth(pkg(300, 300), [res('2027-01-10', 'P0P1', '96'), res('2027-01-10', 'P2P3', 100), res('2027-01-11', 'P0P1', null)]);
    assert.equal(r.color, 'green');
    assert.equal(r.byCategory.P0P1.resolved, 96);
    assert.doesNotMatch(r.reason, /descartada/);
  });

  test('una fila malformada nunca deja el mes en verde si las válidas no lo dan', () => {
    // Rojo con datos válidos; con una resuelta enorme pero decimal sigue rojo.
    const r = evalMonth(pkg(300, 300), [res('2027-01-10', 'P0P1', 10), res('2027-01-10', 'P2P3', 100), res('2027-01-11', 'P0P1', 1000.5)]);
    assert.equal(r.color, 'red');
  });

  test('detectada P0/P1 malformada: se descarta (no sube la meta) y el motivo la menciona', () => {
    // Observación del informe: con la fila descartada la meta queda en 100 y el mes puede ser
    // verde; el aviso queda en el motivo. Una detectada válida sí sube la meta (110 → amarillo).
    const base = [res('2027-01-31', 'P0P1', 100), res('2027-01-31', 'P2P3', 100)];
    const bad = evalMonth(pkg(300, 300), [...base, det('2027-01-05', 30.5)]);
    assert.equal(bad.byCategory.P0P1.target, 100);
    assert.match(bad.reason, /1 medición\(es\) descartada\(s\)/);
    const good = evalMonth(pkg(300, 300), [...base, det('2027-01-05', 30)]);
    assert.equal(good.byCategory.P0P1.target, 110);
    assert.equal(good.color, 'yellow');
  });

  test('la evaluación mensual (build.js) conserva el color y la nota del descarte', () => {
    const r = evaluateIndicatorMonth({
      indicator: VULN, commitment: pkg(300, 300), measurements: [...ok, res('2027-01-11', 'P9', 5)], evalMonth: '2027-01',
    });
    assert.equal(r.color, 'yellow');
    assert.match(r.reason, /descartada/);
  });
});

describe('QA M-06: ventana (trimestre del mes, hasta el cierre del mes)', () => {
  test('no cuenta resueltas del trimestre anterior ni posteriores al cierre del mes', () => {
    const rows = [res('2026-12-31', 'P0P1', 1000), res('2027-01-31', 'P0P1', 96), res('2027-02-01', 'P0P1', 1000), res('2027-01-31', 'P2P3', 100)];
    const r = evalMonth(pkg(300, 300), rows);
    assert.equal(r.byCategory.P0P1.resolved, 96);
    assert.equal(r.byCategory.P0P1.color, 'green');
  });

  test('el segundo trimestre usa su propio paquete y reinicia lo resuelto', () => {
    const rows = [res('2027-03-31', 'P0P1', 500), res('2027-04-15', 'P0P1', 100), res('2027-04-15', 'P2P3', 100)];
    const r = evalMonth(pkg(300, 300, '2027-Q2'), rows, '2027-04');
    assert.equal(r.byCategory.P0P1.resolved, 100);
    assert.equal(r.color, 'green');
  });
});

describe('QA M-06: integración (build.js, dashboard.js, runMonthly) sin targets', () => {
  test('API pública: categoryMonthColor y evaluateCategoryMonth se exportan desde engine/index.js', () => {
    assert.equal(engine.categoryMonthColor, categoryMonthColor);
    assert.equal(engine.evaluateCategoryMonth, evaluateCategoryMonth);
  });

  test('evaluateIndicatorMonth da el mismo color con o sin target (no depende de targets)', () => {
    const rows = [res('2027-01-10', 'P0P1', 95), res('2027-01-10', 'P2P3', 100)];
    const a = evaluateIndicatorMonth({ indicator: VULN, commitment: pkg(300, 300), measurements: rows, target: null, evalMonth: '2027-01' });
    const b = evaluateIndicatorMonth({ indicator: VULN, commitment: pkg(300, 300), measurements: rows, target: { target_value: 1 }, evalMonth: '2027-01' });
    assert.deepEqual(a, b);
    assert.equal(a.color, 'yellow');
  });

  test('el líder ve la misma meta que usa la evaluación (una sola regla)', () => {
    const rows = [det('2027-02-10', 200), res('2027-02-01', 'P0P1', 10)];
    const ev = evalMonth(pkg(1500, 500), rows, '2027-02');
    const goal = categoryGoal({ indicator: VULN, commitment: pkg(1500, 500), measurements: rows, month: '2027-02' });
    assert.equal(goal, `Meta acumulada de 2027-02: P0/P1 ${ev.byCategory.P0P1.target} · P2/P3 ${ev.byCategory.P2P3.target}`);
  });

  test('semilla 2027-Q1 sin filas en targets: colores y valores por criticidad', async () => {
    const { U, I } = IDS;
    const data = seedScenario();
    data.targets = [];
    // Un compromiso mensual de VULN (umbrales negociados) no reemplaza el paquete trimestral.
    data.commitments.push({ unit_id: U.alfa, indicator_id: I.vuln, period: '2027-02', green_override: 50, yellow_override: 10 });
    const db = createFakeDb(data);
    await runMonthly(db, { asOf: '2027-02-01' });
    await runMonthly(db, { asOf: '2027-03-01' });
    const row = (u, m) => db.tables.evaluations.find((e) => e.unit_id === u && e.indicator_id === I.vuln && e.month === m);
    assert.deepEqual([row(U.alfa, '2027-01').color, row(U.alfa, '2027-01').value], ['green', 100]); // 500/500, 250/167
    assert.equal(row(U.alfa, '2027-02').color, 'yellow'); // 1050/1134 = 92,6 %
    assert.ok(Math.abs(row(U.alfa, '2027-02').value - (1050 * 100) / 1134) < 1e-9);
    assert.equal(row(U.beta, '2027-01').color, 'red'); // P0/P1 300/334, P2/P3 0/167
    assert.deepEqual([row(U.gamma, '2027-01').color, row(U.gamma, '2027-01').value], ['yellow', 80]); // P2/P3 80/100
    assert.deepEqual([row(U.gamma, '2027-02').color, row(U.gamma, '2027-02').value], ['red', 40]); // P0/P1 280/400 = 70 %, P2/P3 80/200 = 40 %: rojo/rojo, valor el menor
    for (const e of db.tables.evaluations.filter((x) => x.indicator_id === I.vuln)) {
      assert.match(e.reason, /P0\/P1/);
      assert.match(e.reason, /P2\/P3/);
    }
  });
});

test('QA M-06: categoryMonthColor directo sobre packageStatus (asOf a mitad de mes evalúa ese mes)', () => {
  const cfg = {
    measurementType: 'cumulative_target', direction: 'higher_is_better', windowDays: 90,
    thresholds: { green: 96, yellow: 90 },
    thresholdsByCategory: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } }, minSample: 0,
  };
  const st = packageStatus({
    quarterStart: '2027-01-01', quarterEnd: '2027-03-31', asOf: '2027-02-14',
    initialPackage: { p0p1: 300, p2p3: 300 }, resolved: [],
  });
  const r = categoryMonthColor(cfg, st);
  assert.equal(r.month, '2027-02');
  assert.equal(r.byCategory.P0P1.target, 200);
});
