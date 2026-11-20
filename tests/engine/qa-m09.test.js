// QA M-09: H-M07-QA-01, la meta acumulada mensual nunca supera el paquete trimestral.
// Trazas:
//  - plan-maestro M-09: "`cumulativeThirds` nunca supera el total"; criterio: "prueba unitaria
//    de `cumulativeThirds(0.5)`".
//  - docs/diseno.md, Caso vulnerabilidades: "Meta parcial mensual (aprox. un tercio por mes)",
//    metas acumuladas: el mes 3 es el paquete completo.
//  - CLAUDE.md 6: la misma regla la usan packageStatus, la propuesta de la pantalla (M-07) y las
//    Actions; ninguna puede proponer más que el paquete.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeThirds, proposeThirdTarget } from '../../engine/index.js';

const pkg = (period, total) => ({ unit_id: 'u1', indicator_id: 'i1', period, package_total: total });
const propose = (total, month) =>
  proposeThirdTarget({ commitments: [pkg('2026-Q4', total)], unitId: 'u1', indicatorId: 'i1', month });

describe('QA M-09 · cumulativeThirds acotado al total', () => {
  test('criterio: cumulativeThirds(0.5) no supera 0,5 en ningún mes', () => {
    const r = cumulativeThirds(0.5);
    assert.equal(r.length, 3);
    for (const v of r) assert.ok(v <= 0.5, `${r}`);
    assert.equal(r[2], 0.5, 'el mes 3 es el paquete completo');
  });

  test('paquetes menores que 1 (0,01; 0,1; 0,9; 0,999): nunca superan el total, mes 3 = total', () => {
    for (const P of [0.01, 0.1, 0.9, 0.999]) {
      const [a, b, c] = cumulativeThirds(P);
      assert.ok(a <= b && b <= c, `monótona P=${P}: ${[a, b, c]}`);
      assert.ok(a <= P && b <= P, `acotada P=${P}: ${[a, b, c]}`);
      assert.equal(c, P);
    }
  });

  test('decimales grandes: 1000,5 -> [334, 667, 1000,5] (redondeo hacia arriba sin pasar el total)', () => {
    assert.deepEqual(cumulativeThirds(1000.5), [334, 667, 1000.5]);
  });

  test('borde: paquete 2,5 -> mes 2 = ceil(5/3) = 2 (bajo el total), sin tope innecesario', () => {
    assert.deepEqual(cumulativeThirds(2.5), [1, 2, 2.5]);
  });

  test('regresión enteros (diseño): 2000 -> 667, 1334, 2000; 3 -> 1, 2, 3', () => {
    assert.deepEqual(cumulativeThirds(2000), [667, 1334, 2000]);
    assert.deepEqual(cumulativeThirds(3), [1, 2, 3]);
  });

  test('errores siguen igual: negativo, NaN, Infinity y no número lanzan TypeError', () => {
    for (const bad of [-0.5, NaN, Infinity, -Infinity, '1', null, undefined]) {
      assert.throws(() => cumulativeThirds(/** @type {any} */ (bad)), TypeError, String(bad));
    }
  });

  test('"Proponer un tercio" (pantalla M-07) con paquete 0,5 no propone más que el paquete', () => {
    const vals = ['2026-10', '2026-11', '2026-12'].map((mo) => propose(0.5, mo));
    for (const p of vals) {
      assert.equal(p.ok, true, JSON.stringify(p));
      assert.ok(p.value <= 0.5, `propuesta ${p.value}`);
    }
    assert.equal(vals[2].value, 0.5);
  });
});
