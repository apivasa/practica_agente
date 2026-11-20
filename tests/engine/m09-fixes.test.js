// M-09 (pruebas del desarrollador): H-M07-QA-01, la meta acumulada mensual nunca supera el
// paquete trimestral, también con paquetes decimales.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeThirds } from '../../engine/index.js';

describe('cumulativeThirds con paquete decimal', () => {
  test('0,5 → [0,5, 0,5, 0,5] (antes [1, 1, 0,5])', () => {
    assert.deepEqual(cumulativeThirds(0.5), [0.5, 0.5, 0.5]);
  });

  test('1,5 → [1, 1, 1,5]; 2,4 → [1, 2, 2,4]; 2,9 → [1, 2, 2,9]', () => {
    assert.deepEqual(cumulativeThirds(1.5), [1, 1, 1.5]);
    assert.deepEqual(cumulativeThirds(2.9), [1, 2, 2.9]);
    assert.deepEqual(cumulativeThirds(2.4), [1, 2, 2.4]);
  });

  test('nunca supera el total y es monótona (0..60 en pasos de 0,1)', () => {
    for (let k = 0; k <= 600; k++) {
      const P = k / 10;
      const [a, b, c] = cumulativeThirds(P);
      assert.ok(a <= b && b <= c && c === P, `P=${P}: ${[a, b, c]}`);
      assert.ok(!Object.is(a, -0) && !Object.is(b, -0), `sin -0 P=${P}`);
    }
  });

  test('enteros sin cambios: ceil(P/3), ceil(2P/3), P', () => {
    assert.deepEqual(cumulativeThirds(1), [1, 1, 1]);
    assert.deepEqual(cumulativeThirds(2), [1, 2, 2]);
    assert.deepEqual(cumulativeThirds(2000), [667, 1334, 2000]);
    assert.deepEqual(cumulativeThirds(0), [0, 0, 0]);
  });
});
