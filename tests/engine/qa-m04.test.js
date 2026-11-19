// QA M-04 — CSV con errores se rechaza fila a fila con mensaje (plan-maestro M-04).
// Cada caso traza al criterio: rechazo por fila, mensaje legible, nada se guarda
// si hay errores, y límites anunciados en el módulo (1 MB, 5.000 filas, fórmulas,
// fechas futuras con ctx.today en America/Guayaquil).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMeasurementsCsv, validateMeasurementInput, CSV_MAX_ROWS, CSV_MAX_BYTES,
} from '../../engine/index.js';

const UNITS = [{ id: 'u-alfa', name: 'Unidad Alfa' }, { id: 'u-beta', name: 'Unidad Beta' }];
const ctx = { units: UNITS, today: '2027-02-15' };
const avail = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
const obs = { measurementType: 'coverage', direction: 'higher_is_better', thresholds: { green: 90, yellow: 75 } };
const vuln = {
  measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 },
  thresholdsByCategory: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
};
const rowsOf = (n, line = '2027-01-10,Unidad Alfa,99.9') => Array.from({ length: n }, () => line);

test('BOM UTF-8 al inicio no rompe la cabecera', () => {
  const r = parseMeasurementsCsv('﻿fecha,unidad,valor\n2027-01-10,Unidad Alfa,99.9\n', avail, ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].unitId, 'u-alfa');
});

test('BOM + 1 MB exacto de contenido: el límite cuenta bytes del archivo', () => {
  const head = 'fecha,unidad,valor\n';
  const fill = CSV_MAX_BYTES - head.length;
  const big = head + 'x'.repeat(fill); // exactamente 1 MB
  assert.ok(!/supera 1 MB/.test(parseMeasurementsCsv(big, avail, ctx).errors[0]?.message ?? ''));
  const over = big + 'x';
  assert.match(parseMeasurementsCsv(over, avail, ctx).errors[0].message, /supera 1 MB/);
});

test('>1 MB con multibyte: se mide en bytes UTF-8, no en caracteres', () => {
  const text = 'fecha,unidad,valor\n' + 'á'.repeat(CSV_MAX_BYTES / 2 + 10); // < 1M chars, > 1 MB
  assert.ok(text.length < CSV_MAX_BYTES);
  const r = parseMeasurementsCsv(text, avail, ctx);
  assert.deepEqual(r.rows, []);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].row, null);
  assert.match(r.errors[0].message, /1 MB/);
});

test('comillas: celda con separador y comillas escapadas dentro', () => {
  const r = parseMeasurementsCsv('fecha,unidad,app_id,cumple\n2027-01-10,"Unidad Alfa","app.1","sí"\n', obs, ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows[0].appId, 'app.1');
  // Decimal con coma entre comillas en CSV separado por coma.
  const d = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,Unidad Alfa,"99,5"\n', avail, ctx);
  assert.deepEqual(d.errors, []);
  assert.equal(d.rows[0].value, 99.5);
});

test('comillas sin cerrar: error de archivo con la fila donde empieza', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,Unidad Alfa,99.9\n2027-01-11,"Unidad Alfa,99.9\n', avail, ctx);
  assert.deepEqual(r.rows, []);
  assert.equal(r.errors[0].row, 3);
  assert.match(r.errors[0].message, /sin cerrar/);
});

test('salto de línea dentro de comillas: los números de fila siguientes siguen siendo los del archivo', () => {
  const csv = 'fecha,unidad,app_id,cumple\n2027-01-10,"Unidad\nAlfa",a1,sí\n2027-01-10,Unidad Zeta,a2,sí\n';
  const r = parseMeasurementsCsv(csv, obs, ctx);
  // La fila 2 ocupa líneas 2-3; "Unidad\nAlfa" no existe; la Zeta empieza en la línea 4.
  assert.deepEqual(r.errors.map((e) => e.row), [2, 4]);
});

test('CRLF y CR sueltos se aceptan como fin de línea', () => {
  for (const eol of ['\r\n', '\r']) {
    const r = parseMeasurementsCsv(['fecha,unidad,valor', '2027-01-10,Unidad Alfa,99.9', '2027-01-11,Unidad Beta,99.8', ''].join(eol), avail, ctx);
    assert.deepEqual(r.errors, [], JSON.stringify(eol));
    assert.deepEqual(r.rows.map((x) => x.line), [2, 3]);
  }
});

test('separador ";" se detecta; con decimal con coma', () => {
  const r = parseMeasurementsCsv('fecha;unidad;valor\r\n2027-01-10;Unidad Alfa;99,95\r\n', avail, ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows[0].value, 99.95);
});

test('separador incorrecto (tabulador o "|"): la cabecera se rechaza con mensaje claro', () => {
  for (const sep of ['\t', '|']) {
    const r = parseMeasurementsCsv(`fecha${sep}unidad${sep}valor\n2027-01-10${sep}Unidad Alfa${sep}99.9\n`, avail, ctx);
    assert.deepEqual(r.rows, []);
    assert.equal(r.errors[0].row, 1);
    assert.match(r.errors[0].message, /faltan columnas fecha, unidad, valor/);
  }
});

test('decimal con coma sin comillas en CSV con ",": fila rechazada por número de columnas', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,Unidad Alfa,99,5\n', avail, ctx);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.errors, [{ row: 2, message: 'Tiene 4 columnas y la cabecera 3' }]);
});

test('filas vacías intermedias y finales se ignoran sin alterar la numeración', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor\n\n2027-01-10,Unidad Alfa,99.9\n\n\n2027-01-11,Unidad Alfa,99.8\n\n', avail, ctx);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map((x) => x.line), [3, 6]);
});

test('fila de solo separadores (",,") no se guarda: produce mensaje en su fila', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,Unidad Alfa,99.9\n,,\n', avail, ctx);
  assert.deepEqual(r.rows, []);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].row, 3);
  assert.match(r.errors[0].message, /fecha: obligatoria/);
});

test('solo cabecera (con líneas en blanco): "no tiene filas de datos"', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor\n\n\n', avail, ctx);
  assert.match(r.errors[0].message, /no tiene filas de datos/);
});

test('archivo vacío, solo BOM o solo espacios: "está vacío"', () => {
  for (const t of ['', '﻿', '  \n \n']) {
    assert.match(parseMeasurementsCsv(t, avail, ctx).errors[0].message, /vacío/, JSON.stringify(t));
  }
});

test('5.000 filas se aceptan; 5.001 se rechazan sin validar filas', () => {
  assert.equal(CSV_MAX_ROWS, 5000);
  const ok = parseMeasurementsCsv(['fecha,unidad,valor', ...rowsOf(5000)].join('\n'), avail, ctx);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.rows.length, 5000);
  const ko = parseMeasurementsCsv(['fecha,unidad,valor', ...rowsOf(5001)].join('\n'), avail, ctx);
  assert.deepEqual(ko.rows, []);
  assert.deepEqual(ko.errors, [{ row: null, message: 'El archivo tiene 5001 filas; el máximo es 5000' }]);
});

test('5.000 filas con líneas en blanco intercaladas siguen contando como 5.000', () => {
  const lines = ['fecha,unidad,valor'];
  for (const l of rowsOf(5000)) lines.push(l, '');
  assert.equal(parseMeasurementsCsv(lines.join('\n'), avail, ctx).rows.length, 5000);
});

test('fórmulas: = + - @ al inicio de cualquier celda, también con espacios previos o entre comillas', () => {
  const cells = ['=1+1', '+1', '-1', '@SUM(A1)', ' =1+1', '"=HYPERLINK(""http://x"")"', '"\t=1"'];
  for (const c of cells) {
    const r = parseMeasurementsCsv(`fecha,unidad,app_id,cumple\n2027-01-10,Unidad Alfa,${c},sí\n`, obs, ctx);
    assert.deepEqual(r.rows, [], c);
    assert.equal(r.errors[0].row, 2, c);
    assert.match(r.errors[0].message, /app_id: la celda empieza con =/, c);
  }
  // En la columna unidad también.
  const u = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,=cmd|\' /C calc\'!A0,99\n', avail, ctx);
  assert.match(u.errors[0].message, /unidad: la celda empieza con =/);
});

test('fechas futuras se rechazan respecto a ctx.today; hoy se acepta', () => {
  const csv = 'fecha,unidad,valor\n2027-02-15,Unidad Alfa,99.9\n2027-02-16,Unidad Alfa,99.9\n';
  const r = parseMeasurementsCsv(csv, avail, ctx);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.errors, [{ row: 3, message: 'fecha: 2027-02-16 es futura' }]);
});

test('fechas inválidas: formato, día inexistente, año < 2000', () => {
  const csv = 'fecha,unidad,valor\n15/01/2027,Unidad Alfa,1\n2027-02-29,Unidad Alfa,1\n1999-12-31,Unidad Alfa,1\n2027-1-5,Unidad Alfa,1\n';
  const r = parseMeasurementsCsv(csv, avail, ctx);
  assert.deepEqual(r.errors.map((e) => e.row), [2, 3, 4, 5]);
  assert.match(r.errors[2].message, /anterior al año 2000/);
});

test('unidad inexistente: mensaje con el nombre; unidad por nombre sin distinguir mayúsculas o por id', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,Unidad Gamma,1\n2027-01-10,UNIDAD BETA,1\n2027-01-10,u-alfa,1\n', avail, ctx);
  assert.deepEqual(r.errors, [{ row: 2, message: 'unidad: "Unidad Gamma" no existe' }]);
  // Con un error, no se devuelve ninguna fila para guardar.
  assert.deepEqual(r.rows, []);
  const ok = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,UNIDAD BETA,1\n2027-01-10,u-alfa,1\n', avail, ctx);
  assert.deepEqual(ok.rows.map((x) => x.unitId), ['u-beta', 'u-alfa']);
});

test('unidad con nombre de propiedad de Object ("constructor", "__proto__") no existe', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,constructor,1\n2027-01-10,__proto__,1\n2027-01-10,toString,1\n', avail, ctx);
  assert.deepEqual(r.errors.map((e) => e.row), [2, 3, 4]);
});

test('tipo (kind) inválido, incluido "constructor"/"toString"; alias válidos y vacío = resuelta', () => {
  const head = 'fecha,unidad,valor,categoria,tipo\n';
  const bad = parseMeasurementsCsv(head + '2027-01-10,Unidad Alfa,3,P0P1,cerrada\n2027-01-10,Unidad Alfa,3,P0P1,constructor\n2027-01-10,Unidad Alfa,3,P0P1,toString\n', vuln, ctx);
  assert.deepEqual(bad.errors.map((e) => e.row), [2, 3, 4]);
  assert.match(bad.errors[0].message, /tipo: "cerrada" debe ser resuelta o detectada/);
  const ok = parseMeasurementsCsv(head + '2027-01-10,Unidad Alfa,3,P0P1,Detectadas\n2027-01-10,Unidad Alfa,3,p2p3,\n', vuln, ctx);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.rows.map((x) => [x.kind, x.category]), [['detected', 'P0P1'], ['resolved', 'P2P3']]);
});

test('categoría inválida u omitida cuando el indicador tiene categorías', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor,categoria\n2027-01-10,Unidad Alfa,3,P4\n2027-01-10,Unidad Alfa,3,\n', vuln, ctx);
  assert.deepEqual(r.errors.map((e) => e.row), [2, 3]);
  assert.match(r.errors[0].message, /"P4" no es una de P0P1, P2P3/);
  assert.match(r.errors[1].message, /categoria: obligatoria/);
  // Sin columna categoria en la cabecera: también obligatoria por fila.
  const noCol = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,Unidad Alfa,3\n', vuln, ctx);
  assert.match(noCol.errors[0].message, /categoria: obligatoria/);
});

test('valor en meta acumulada: entero >= 0; decimal, negativo, notación científica rechazados', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor,categoria\n2027-01-10,Unidad Alfa,1.5,P0P1\n2027-01-10,Unidad Alfa,1e3,P0P1\n2027-01-10,Unidad Alfa,99999999999999999999,P0P1\n', vuln, ctx);
  assert.deepEqual(r.errors.map((e) => e.row), [2, 3, 4]);
  assert.match(r.errors[2].message, /fuera de rango/);
});

test('cabecera: acentos y mayúsculas se normalizan; columna desconocida o repetida se rechaza', () => {
  const ok = parseMeasurementsCsv('Fecha,UNIDAD,Valor,Categoría,Tipo\n2027-01-10,Unidad Alfa,3,P0P1,resuelta\n', vuln, ctx);
  assert.deepEqual(ok.errors, []);
  const unk = parseMeasurementsCsv('fecha,unidad,valor,__proto__\n2027-01-10,Unidad Alfa,1,x\n', avail, ctx);
  assert.match(unk.errors[0].message, /no reconocidas __proto__/);
  const dup = parseMeasurementsCsv('fecha,unidad,valor,valor\n2027-01-10,Unidad Alfa,1,2\n', avail, ctx);
  assert.match(dup.errors[0].message, /repetidas valor/);
});

test('rechazo fila a fila: varias filas con errores distintos, todas reportadas, sin filas para guardar', () => {
  const csv = 'fecha,unidad,app_id,cumple\n2027-01-10,Unidad Alfa,a1,sí\n2027-03-01,Unidad Alfa,a2,quizá\n2027-01-10,Nadie,a 3,sí\n2027-01-10,Unidad Beta,a4,no\n';
  const r = parseMeasurementsCsv(csv, obs, ctx);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.errors.map((e) => e.row), [3, 4]);
  // Varios errores de una fila van en un único mensaje separado por "; ".
  assert.match(r.errors[0].message, /fecha: 2027-03-01 es futura; cumple: "quizá" debe ser sí o no/);
  assert.match(r.errors[1].message, /unidad: "Nadie" no existe; app_id:/);
});

test('captura manual: misma validación que el CSV (fecha futura y fórmula)', () => {
  const r = validateMeasurementInput(avail, { fecha: '2027-02-16', unidad: 'Unidad Alfa', valor: '=1' }, ctx);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.field).sort(), ['fecha', 'valor']);
});

test('tipo de indicador desconocido o texto no-string: error de archivo', () => {
  assert.match(parseMeasurementsCsv('a', { measurementType: 'toString' }, ctx).errors[0].message, /tipo de medición/);
  assert.match(parseMeasurementsCsv(null, avail, ctx).errors[0].message, /no se pudo leer/);
});
