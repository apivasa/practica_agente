// Seguridad (M-10), categoría 3: residual H-M10-01. Un numeric finito en PostgreSQL pero
// mayor que Number.MAX_VALUE (p. ej. 1e400) pasa los CHECK de M-10 y PostgREST lo devuelve
// como literal JSON numérico; JSON.parse lo convierte en Infinity. Se verifica que el motor
// lo neutraliza (num → null, sin meta / paquete inválido) y no fuerza un color.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, buildPackageInput } from '../../engine/rows.js';

const huge = JSON.parse('{"v": 1' + '0'.repeat(400) + ', "e": 1e400}');

test('JSON.parse de un numeric > 1.8e308 produce Infinity (premisa del residual)', () => {
  assert.equal(huge.v, Infinity);
  assert.equal(huge.e, Infinity);
});

test('num() neutraliza el Infinity que llega de la API', () => {
  assert.equal(num(huge.v), null);
  assert.equal(num(-huge.v), null);
  assert.equal(num('1e400'), null);
});

test('buildPackageInput rechaza un paquete por criticidad con 1e400 (no lo toma como 0 ni como infinito)', () => {
  const r = buildPackageInput({
    indicator: { thresholds_by_category: { P0P1: { green: 96, yellow: 90 } } },
    commitment: { package_by_category: { P0P1: huge.v, P2P3: 10 } },
    measurements: [],
    asOf: '2031-02-15',
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /P0P1 no es un número/);
});
