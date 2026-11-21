// QA F-11 (tester) — punto 5 del ítem (plan-maestro, fila F-11):
//  "QA V-07b info: negativo en notación científica con mensaje «≥ 0»".
// El .xlsx se arma con el generador de fixtures de V-07 (estructura de Excel), no con el
// del desarrollador. Se exige además no romper V-07b: el CSV escrito a mano no cambia y los
// valores válidos se siguen aceptando.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeasurementsCsv, parseMeasurementsXlsx } from '../../engine/index.js';
import { inflateRaw } from '../../src/lib/inflate.js';
import { workbook, rowsXml } from '../fixtures/v07/ooxml.js';

const UNITS = [{ id: 'u-alfa', name: 'Unidad Alfa' }];
const CTX = { units: UNITS, today: '2027-02-15' };
const AVAIL = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
const VULN = {
  measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 },
  thresholdsByCategory: { P0P1: { green: 96, yellow: 90 } },
};
const u8 = (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
/** Celda numérica con el texto crudo que Excel escribe en <v> (p. ej. "-1E+21"). */
const num = (raw) => ({ xml: `<c r="{ref}"><v>${raw}</v></c>` });
const sheet = (cols, rows) => workbook(rowsXml([cols], 1) + rowsXml(rows));
const xlsx = (bytes, ind = AVAIL) => parseMeasurementsXlsx(u8(bytes), ind, CTX, inflateRaw);
const msgs = (r) => r.errors.map((e) => e.message).join(' | ');

describe('F-11 punto 5: negativo de Excel en notación científica → «≥ 0»', () => {
  // Excel guarda con exponente los números muy grandes o muy pequeños (≥ 1E+21 o < 1E-6).
  for (const raw of ['-1E+21', '-2.5E+22', '-1.7976931348623157E+308', '-1E-7', '-2.5E-10', '-1E-300', '-4.9E-324']) {
    test(`valor ${raw} (indicador de promedio) → rechazado con «debe ser un número ≥ 0», sin «posible fórmula»`, async () => {
      const r = await xlsx(sheet(['fecha', 'unidad', 'valor'], [['2027-01-10', 'Unidad Alfa', num(raw)]]));
      assert.equal(r.rows.length, 0, 'un negativo nunca se importa');
      assert.match(msgs(r), /debe ser un número ≥ 0/);
      assert.doesNotMatch(msgs(r), /posible fórmula/);
    });
  }

  test('indicador de enteros (vulnerabilidades): -1E+21 → «debe ser un entero ≥ 0»', async () => {
    const r = await xlsx(sheet(['fecha', 'unidad', 'valor', 'categoria'], [['2027-01-10', 'Unidad Alfa', num('-1E+21'), 'P0P1']]), VULN);
    assert.equal(r.rows.length, 0);
    assert.match(msgs(r), /debe ser un entero ≥ 0/);
    assert.doesNotMatch(msgs(r), /posible fórmula/);
  });

  test('el mensaje de un negativo con cientos de dígitos es legible (recortado, no arrastra 300 cifras)', async () => {
    const r = await xlsx(sheet(['fecha', 'unidad', 'valor'], [['2027-01-10', 'Unidad Alfa', num('-1.7976931348623157E+308')]]));
    const m = r.errors.find((e) => /≥ 0/.test(e.message))?.message ?? '';
    assert.ok(m.length > 0, msgs(r));
    assert.doesNotMatch(m, /\d{40}/, 'no muestra decenas de dígitos seguidos');
  });

  test('con una fila válida al lado, el negativo científico se reporta una sola vez con «≥ 0»', async () => {
    const r = await xlsx(sheet(['fecha', 'unidad', 'valor'], [
      ['2027-01-10', 'Unidad Alfa', num('99.95')],
      ['2027-01-11', 'Unidad Alfa', num('-1E+21')],
    ]));
    assert.match(msgs(r), /≥ 0/);
    assert.equal(r.errors.filter((e) => /≥ 0/.test(e.message)).length, 1);
  });

  test('sin regresión: positivo con exponente de Excel no se trata como negativo', async () => {
    const r = await xlsx(sheet(['fecha', 'unidad', 'valor'], [['2027-01-10', 'Unidad Alfa', num('1E+21')]]));
    assert.doesNotMatch(msgs(r), /≥ 0 \(no se aceptan negativos/);
  });

  test('sin regresión: negativo decimal normal de Excel sigue con «≥ 0» y 0 sigue aceptado', async () => {
    const neg = await xlsx(sheet(['fecha', 'unidad', 'valor'], [['2027-01-10', 'Unidad Alfa', num('-0.5')]]));
    assert.match(msgs(neg), /debe ser un número ≥ 0/);
    const zero = await xlsx(sheet(['fecha', 'unidad', 'valor'], [['2027-01-10', 'Unidad Alfa', num('0')]]));
    assert.deepEqual(zero.errors, []);
    assert.equal(zero.rows[0].value, 0);
  });

  test('sin regresión: en CSV, el texto «-1E+21» escrito a mano sigue rechazado como posible fórmula', () => {
    const r = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,Unidad Alfa,-1E+21\n', AVAIL, CTX);
    assert.equal(r.rows.length, 0);
    assert.match(msgs(r), /posible fórmula/);
  });

  test('sin regresión: texto (inlineStr) «-1E+21» en Excel no es un número de celda: sigue como posible fórmula', async () => {
    const r = await xlsx(sheet(['fecha', 'unidad', 'valor'], [['2027-01-10', 'Unidad Alfa', '-1E+21']]));
    assert.equal(r.rows.length, 0);
    assert.match(msgs(r), /posible fórmula/);
  });
});
