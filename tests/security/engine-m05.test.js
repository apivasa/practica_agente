// M-05 — Pruebas de seguridad del motor de vulnerabilidades (engine/vulnerabilities.js).
// Categorías: 3 (inyección y entradas), 5 (automatizaciones: que una alerta no se apague
// con datos manipulados), 6 (código: sin eval/red/secretos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  packageStatus,
  paceStatus,
  recalculateOnNewCritical,
  DEFAULT_COMPLIANCE_THRESHOLDS,
} from '../../engine/index.js';

const SRC = readFileSync(fileURLToPath(new URL('../../engine/vulnerabilities.js', import.meta.url)), 'utf8');

const base = () => ({
  quarterStart: '2026-01-01',
  quarterEnd: '2026-03-31',
  asOf: '2026-02-15',
  initialPackage: { p0p1: 300, p2p3: 600 },
  newCritical: [{ detectedOn: '2026-01-20', count: 30 }],
  resolved: [
    { resolvedOn: '2026-01-31', criticality: 'P0P1', count: 100 },
    { resolvedOn: '2026-02-10', criticality: 'P2P3', count: 200 },
  ],
});

// ---------- Categoría 3: conteos manipulados ----------

const BAD_COUNTS = [-1, -0.5, 1.5, NaN, Infinity, -Infinity, '10', '1e3', null, true, [], {}, 10n];
for (const bad of BAD_COUNTS) {
  const label = typeof bad === 'bigint' ? `${bad}n` : JSON.stringify(bad) ?? String(bad);
  test(`3 · initialPackage.p0p1 = ${label} se rechaza`, () => {
    assert.throws(() => packageStatus({ ...base(), initialPackage: { p0p1: bad, p2p3: 0 } }), TypeError);
  });
  test(`3 · newCritical.count = ${label} se rechaza (no baja la meta)`, () => {
    assert.throws(
      () => packageStatus({ ...base(), newCritical: [{ detectedOn: '2026-01-05', count: bad }] }),
      TypeError,
    );
  });
  test(`3 · resolved.count = ${label} se rechaza (no infla lo resuelto)`, () => {
    assert.throws(
      () =>
        packageStatus({
          ...base(),
          resolved: [{ resolvedOn: '2026-01-05', criticality: 'P0P1', count: bad }],
        }),
      TypeError,
    );
  });
}

test('3 · count -0 no resta del paquete', () => {
  const s = packageStatus({ ...base(), newCritical: [{ detectedOn: '2026-01-05', count: -0 }] });
  assert.equal(s.effectiveTotal.p0p1, 300);
});

test('3 · un solo elemento inválido invalida todo el cálculo (no se ignora en silencio)', () => {
  const input = base();
  input.resolved.push(/** @type {any} */ (null));
  assert.throws(() => packageStatus(input), TypeError);
  const input2 = base();
  input2.newCritical.push(/** @type {any} */ ('x'));
  assert.throws(() => packageStatus(input2), TypeError);
});

test('3 · criticidad desconocida o con mayúsculas/espacios se rechaza', () => {
  for (const c of ['p0p1', 'P0P1 ', 'P0', 'P4', '', null, ['P0P1'], { toString: () => 'P0P1' }]) {
    assert.throws(
      () => packageStatus({ ...base(), resolved: [{ resolvedOn: '2026-01-05', criticality: c, count: 1 }] }),
      TypeError,
    );
  }
});

test('3 · arreglos sustituidos por objetos tipo arreglo se rechazan', () => {
  assert.throws(() => packageStatus({ ...base(), resolved: /** @type {any} */ ({ length: 1, 0: {} }) }), TypeError);
  assert.throws(() => packageStatus({ ...base(), newCritical: /** @type {any} */ ('abc') }), TypeError);
});

// ---------- Categoría 3: fechas manipuladas ----------

const BAD_DATES = ['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-05', '2026-01-05T00:00', ' 2026-01-05', '2026-01-05\n', '٢٠٢٦-٠١-٠٥', 20260105, null];
for (const bad of BAD_DATES) {
  test(`3 · fecha ${JSON.stringify(bad)} se rechaza en asOf, detectedOn y resolvedOn`, () => {
    assert.throws(() => packageStatus({ ...base(), asOf: bad }));
    assert.throws(() => packageStatus({ ...base(), newCritical: [{ detectedOn: bad, count: 1 }] }));
    assert.throws(() =>
      packageStatus({ ...base(), resolved: [{ resolvedOn: bad, criticality: 'P0P1', count: 1 }] }),
    );
  });
}

test('3 · detección del mes 1 fechada en el futuro (después de asOf) se rechaza', () => {
  assert.throws(
    () => packageStatus({ ...base(), newCritical: [{ detectedOn: '2026-03-20', count: 50 }] }),
    RangeError,
  );
});

test('3 · resoluciones fuera del trimestre (anterior o siguiente) se rechazan', () => {
  for (const d of ['2025-12-31', '2026-04-01']) {
    assert.throws(
      () => packageStatus({ ...base(), asOf: '2026-03-31', resolved: [{ resolvedOn: d, criticality: 'P0P1', count: 999 }] }),
      RangeError,
    );
  }
});

test('3 · trimestre de 2 o 4 meses, invertido o asOf anterior al inicio se rechaza', () => {
  assert.throws(() => packageStatus({ ...base(), quarterEnd: '2026-02-28' }), RangeError);
  assert.throws(() => packageStatus({ ...base(), quarterEnd: '2026-04-30' }), RangeError);
  assert.throws(() => packageStatus({ ...base(), quarterStart: '2026-04-01' }), RangeError);
  assert.throws(() => packageStatus({ ...base(), asOf: '2025-12-31' }), RangeError);
});

test('3 · los errores no reflejan payload HTML en asOf inválido', () => {
  const xss = '<img src=x onerror=alert(1)>';
  assert.throws(() => packageStatus({ ...base(), asOf: xss }), (e) => !String(e.message).includes('<img'));
});

// ---------- Categoría 3: umbrales ----------

for (const bad of [-1, 100.0001, 101, NaN, Infinity, '96', null, true]) {
  test(`3 · umbral p0p1 = ${String(bad)} se rechaza (no abarata el cumplimiento)`, () => {
    if (bad === null) {
      // null equivale a "no informado" (??) y usa el valor por defecto, nunca 0.
      const s = packageStatus({ ...base(), thresholds: { p0p1: null } });
      assert.equal(s.compliance.thresholds.p0p1, DEFAULT_COMPLIANCE_THRESHOLDS.p0p1);
      return;
    }
    assert.throws(() => packageStatus({ ...base(), thresholds: { p0p1: bad } }), TypeError);
  });
}

test('3 · thresholds no objeto se rechaza', () => {
  for (const t of [null, 5, 'x']) {
    assert.throws(() => packageStatus({ ...base(), thresholds: /** @type {any} */ (t) }), TypeError);
  }
});

test('3 · los umbrales por defecto están congelados', () => {
  assert.ok(Object.isFrozen(DEFAULT_COMPLIANCE_THRESHOLDS));
  assert.throws(() => {
    'use strict';
    /** @type {any} */ (DEFAULT_COMPLIANCE_THRESHOLDS).p0p1 = 0;
  });
  assert.equal(DEFAULT_COMPLIANCE_THRESHOLDS.p0p1, 96);
});

test('3 · __proto__ en thresholds vía JSON.parse no baja el umbral ni contamina Object.prototype', () => {
  const thresholds = JSON.parse('{"__proto__":{"p0p1":0,"p2p3":0}}');
  const s = packageStatus({ ...base(), thresholds });
  assert.deepEqual(s.compliance.thresholds, { p0p1: 96, p2p3: 85 });
  assert.equal(/** @type {any} */ ({}).p0p1, undefined);
});

test('3 · __proto__ en initialPackage vía JSON.parse no aporta conteos', () => {
  const initialPackage = JSON.parse('{"__proto__":{"p0p1":5,"p2p3":5}}');
  assert.throws(() => packageStatus({ ...base(), initialPackage }), TypeError);
});

test('3 · H-M05-03 (abierto, documentado): umbrales heredados del prototipo se leen', () => {
  // Solo alcanzable si quien llama construye el objeto con Object.create; JSON no puede.
  const s = packageStatus({ ...base(), thresholds: Object.create({ p0p1: 0, p2p3: 0 }) });
  assert.deepEqual(s.compliance.thresholds, { p0p1: 0, p2p3: 0 });
});

// ---------- Categoría 3/5: resultados que no deben dar "al día" o "cumple" sin serlo ----------

test('5 · cumplimiento acotado a 100 % aunque se reporten más resoluciones que el paquete', () => {
  const s = packageStatus({
    ...base(),
    resolved: [{ resolvedOn: '2026-01-31', criticality: 'P0P1', count: 1_000_000 }],
  });
  assert.equal(s.compliance.p0p1Pct, 100);
  assert.equal(s.pending.p0p1, 0);
});

test('5 · resolver P2/P3 no hace cumplir P0/P1 (cumplimiento por criticidad separado)', () => {
  const s = packageStatus({
    ...base(),
    resolved: [{ resolvedOn: '2026-01-31', criticality: 'P2P3', count: 600 }],
  });
  assert.equal(s.compliance.meetsP0P1, false);
  assert.equal(s.compliance.meetsP2P3, true);
});

test('5 · 95,99 % de P0/P1 no cumple el 96 % (tolerancia no regala cumplimiento)', () => {
  const s = packageStatus({
    ...base(),
    asOf: '2026-03-31',
    newCritical: [],
    initialPackage: { p0p1: 10000, p2p3: 0 },
    resolved: [{ resolvedOn: '2026-03-30', criticality: 'P0P1', count: 9599 }],
  });
  assert.equal(s.compliance.meetsP0P1, false);
});

test('5 · H-M05-01 (abierto, documentado): exceso de P2/P3 resueltas oculta el atraso en P0/P1', () => {
  // 0 P0/P1 resueltas y 500 P2/P3 sobre un paquete de 300: el ritmo total queda "al día".
  const s = packageStatus({
    quarterStart: '2026-01-01',
    quarterEnd: '2026-03-31',
    asOf: '2026-01-31',
    initialPackage: { p0p1: 300, p2p3: 300 },
    resolved: [{ resolvedOn: '2026-01-10', criticality: 'P2P3', count: 500 }],
  });
  assert.equal(s.resolvedToDate.total, 500); // no acotado al efectivo (300)
  assert.equal(s.pending.p0p1, 300);
  assert.equal(paceStatus(s).behind, false);
});

test('5 · H-M05-02 (abierto, documentado): conteos enormes dan NaN y el ritmo queda "al día"', () => {
  const s = packageStatus({ ...base(), initialPackage: { p0p1: 1e308, p2p3: 1e308 }, newCritical: [], resolved: [] });
  assert.equal(s.effectiveTotal.total, Infinity);
  const p = paceStatus(s);
  assert.ok(Number.isNaN(p.expected));
  assert.equal(p.behind, false); // falla abierta: debería lanzar o marcar atraso
});

test('5 · asOf muy posterior al trimestre exige el total (atraso visible)', () => {
  const s = packageStatus({ ...base(), asOf: '2099-01-01' });
  assert.equal(s.currentMonthIndex, null);
  assert.equal(s.weeksRemaining, 0);
  assert.equal(paceStatus(s).behind, true);
});

test('5 · el último día del trimestre exige el total efectivo', () => {
  const s = packageStatus({ ...base(), asOf: '2026-03-31' });
  const p = paceStatus(s);
  assert.equal(p.expected, s.effectiveTotal.total);
  assert.equal(p.behind, true);
});

test('5 · ingreso de P0/P1 en mes 3 no reduce la meta del trimestre actual ni la oculta', () => {
  const prev = packageStatus({ ...base(), asOf: '2026-03-05' });
  const next = packageStatus({
    ...base(),
    asOf: '2026-03-05',
    newCritical: [...base().newCritical, { detectedOn: '2026-03-02', count: 40 }],
  });
  const r = recalculateOnNewCritical(prev, next);
  assert.equal(r.targetChanged, false);
  assert.equal(r.carryDelta, 40);
  assert.equal(next.pendingCarry, prev.pendingCarry + 40);
});

test('5 · ingreso de P0/P1 en mes 1 sí dispara recálculo', () => {
  const prev = packageStatus(base());
  const next = packageStatus({ ...base(), newCritical: [...base().newCritical, { detectedOn: '2026-02-01', count: 1 }] });
  assert.equal(recalculateOnNewCritical(prev, next).targetChanged, true);
});

test('5 · paceStatus y recalculateOnNewCritical rechazan estados que no vienen de packageStatus', () => {
  for (const s of [null, {}, { monthlyTargets: [] }, 'x', { ...packageStatus(base()), asOf: '2026-02-30' }]) {
    assert.throws(() => paceStatus(/** @type {any} */ (s)), TypeError);
    assert.throws(() => recalculateOnNewCritical(/** @type {any} */ (s), packageStatus(base())), TypeError);
  }
});

// ---------- Categoría 3: mutación de entradas ----------

test('3 · packageStatus no muta la entrada', () => {
  const input = base();
  const snapshot = structuredClone(input);
  packageStatus(input);
  assert.deepEqual(input, snapshot);
});

test('3 · packageStatus acepta entradas congeladas en profundidad', () => {
  const deepFreeze = (o) => {
    Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
    return Object.freeze(o);
  };
  assert.doesNotThrow(() => packageStatus(deepFreeze(base())));
});

test('3 · paceStatus y recalculateOnNewCritical no mutan los estados', () => {
  const a = packageStatus(base());
  const b = packageStatus({ ...base(), newCritical: [] });
  const sa = structuredClone(a);
  const sb = structuredClone(b);
  paceStatus(a);
  paceStatus(a, { monthToDate: false });
  recalculateOnNewCritical(b, a);
  assert.deepEqual(a, sa);
  assert.deepEqual(b, sb);
});

test('3 · el resultado no comparte referencias mutables con la entrada', () => {
  const input = base();
  const s = packageStatus(input);
  s.compliance.thresholds.p0p1 = 0;
  assert.equal(DEFAULT_COMPLIANCE_THRESHOLDS.p0p1, 96);
  assert.notEqual(/** @type {any} */ (s).initialPackage, input.initialPackage);
});

test('3 · complejidad lineal con 200 000 resoluciones', () => {
  const resolved = Array.from({ length: 200_000 }, () => ({ resolvedOn: '2026-01-15', criticality: 'P2P3', count: 0 }));
  const t0 = Date.now();
  packageStatus({ ...base(), resolved });
  assert.ok(Date.now() - t0 < 2000);
});

// ---------- Categoría 6: código ----------

test('6 · sin eval, Function, import dinámico ni red', () => {
  assert.doesNotMatch(SRC, /\beval\s*\(|new\s+Function|\bimport\s*\(|fetch\s*\(|XMLHttpRequest|require\s*\(|process\.|from\s+['"]node:/);
  for (const m of SRC.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.match(m[1], /^\.\//);
});

test('6 · sin secretos en el código', () => {
  assert.doesNotMatch(SRC, /sb_secret_|sb_publishable_|service_role|eyJ[A-Za-z0-9_-]{10,}|BEGIN [A-Z ]*PRIVATE KEY/);
});
