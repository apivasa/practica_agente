// M-04 — engine/measurements-input.js (captura manual y CSV)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMeasurementsCsv, validateMeasurementInput, tokenizeCsv, isFormulaLike, CSV_MAX_ROWS,
} from '../../engine/index.js';

const UNITS = [{ id: 'u-alfa', name: 'Unidad Alfa' }, { id: 'u-beta', name: 'Unidad Beta' }];
const avail = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
const obs = { measurementType: 'coverage', direction: 'higher_is_better', thresholds: { green: 90, yellow: 75 } };
const vuln = {
  measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 },
  thresholdsByCategory: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
};
const ctx = { units: UNITS, today: '2027-02-15' };

test('tokenizeCsv: comillas, comillas escapadas, CRLF y saltos dentro de comillas', () => {
  const { records } = tokenizeCsv('a,b\r\n"x,1","di ""hola""\notra"\n\nc,d\n');
  assert.deepEqual(records, [
    { line: 1, cells: ['a', 'b'] },
    { line: 2, cells: ['x,1', 'di "hola"\notra'] },
    { line: 5, cells: ['c', 'd'] },
  ]);
  assert.match(tokenizeCsv('a,"b\n').error.message, /sin cerrar/);
  assert.match(tokenizeCsv('a,b"c\n').error.message, /fuera de lugar/);
});

test('isFormulaLike detecta = + - @ y caracteres de control al inicio', () => {
  for (const c of ['=1+1', '+1', '-2', '@SUM(A1)', '\t=1', '\r=1']) assert.ok(isFormulaLike(c), JSON.stringify(c));
  for (const c of ['1', 'app-1', 'Unidad Alfa', '']) assert.ok(!isFormulaLike(c), c);
});

test('CSV válido de promedio en ventana: unidad por nombre o id, separador ;', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-15,Unidad Alfa,99.95\n2027-01-16,u-beta,99\n', avail, ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { date: '2027-01-15', unitId: 'u-alfa', value: 99.95, appId: null, compliant: null, category: null, kind: null, line: 2 });
  const semi = parseMeasurementsCsv('﻿Fecha;Unidad;Valor\r\n2027-01-15;unidad alfa;99,5\r\n', avail, ctx);
  assert.deepEqual(semi.errors, []);
  assert.equal(semi.rows[0].value, 99.5);
});

test('CSV con errores: se rechaza fila a fila con número y motivo, y no devuelve filas', () => {
  const text = [
    'fecha,unidad,valor',
    '2027-02-30,Unidad Alfa,99',   // 2 fecha irreal
    '2027-01-10,Unidad Zeta,99',   // 3 unidad inexistente
    '2027-01-10,Unidad Alfa,-1',   // 4 negativo (y empieza con -)
    '2027-01-10,Unidad Alfa,abc',  // 5 no numérico
    '2027-01-10,Unidad Alfa,=1+1', // 6 fórmula
    '2027-03-01,Unidad Alfa,99',   // 7 futura
    '2027-01-10,Unidad Alfa',      // 8 columnas
    '2027-01-11,Unidad Alfa,99.9', // 9 válida
  ].join('\n');
  const r = parseMeasurementsCsv(text, avail, ctx);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.errors.map((e) => e.row), [2, 3, 4, 5, 6, 7, 8]);
  assert.match(r.errors[0].message, /fecha real/);
  assert.match(r.errors[1].message, /no existe/);
  assert.match(r.errors[2].message, /fórmula/);
  assert.match(r.errors[3].message, /número/);
  assert.match(r.errors[4].message, /fórmula/);
  assert.match(r.errors[5].message, /futura/);
  assert.match(r.errors[6].message, /columnas/);
});

test('cobertura: app_id y cumple sí/no', () => {
  const r = parseMeasurementsCsv('fecha,unidad,app_id,cumple\n2027-01-31,Unidad Alfa,app-1,sí\n2027-01-31,Unidad Beta,app-2,No\n', obs, ctx);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map((x) => [x.appId, x.compliant]), [['app-1', true], ['app-2', false]]);
  const bad = parseMeasurementsCsv('fecha,unidad,app_id,cumple\n2027-01-31,Unidad Alfa,@app,quizá\n2027-01-31,Unidad Alfa,,si\n', obs, ctx);
  assert.equal(bad.errors.length, 2);
  assert.match(bad.errors[0].message, /fórmula/);
  assert.match(bad.errors[0].message, /sí o no/);
  assert.match(bad.errors[1].message, /app_id: obligatorio/);
});

test('meta acumulada: entero, categoría del indicador y tipo resuelta/detectada', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor,categoria,tipo\n2027-01-31,Unidad Alfa,120,p0p1,detectada\n2027-01-31,Unidad Alfa,450,P2P3,\n', vuln, ctx);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map((x) => [x.value, x.category, x.kind]), [[120, 'P0P1', 'detected'], [450, 'P2P3', 'resolved']]);
  const bad = parseMeasurementsCsv('fecha,unidad,valor,categoria,tipo\n2027-01-31,Unidad Alfa,1.5,P9,otra\n2027-01-31,Unidad Alfa,3,,resuelta\n', vuln, ctx);
  assert.match(bad.errors[0].message, /entero/);
  assert.match(bad.errors[0].message, /no es una de P0P1, P2P3/);
  assert.match(bad.errors[0].message, /resuelta o detectada/);
  assert.match(bad.errors[1].message, /categoria: obligatoria/);
  // Columnas opcionales ausentes: sin categorías definidas y tipo por defecto.
  const plain = { ...vuln, thresholdsByCategory: {} };
  const ok = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-31,Unidad Alfa,3\n', plain, ctx);
  assert.deepEqual(ok.rows.map((x) => [x.category, x.kind]), [[null, 'resolved']]);
});

test('errores de archivo: vacío, cabecera, tamaño y filas máximas', () => {
  assert.match(parseMeasurementsCsv('', avail, ctx).errors[0].message, /vacío/);
  assert.match(parseMeasurementsCsv('fecha,unidad,valor\n', avail, ctx).errors[0].message, /no tiene filas/);
  const head = parseMeasurementsCsv('fecha,unit,valor,extra\n', avail, ctx).errors.map((e) => e.message).join(' | ');
  assert.match(head, /faltan columnas unidad/);
  assert.match(head, /no reconocidas unit, extra/);
  assert.match(parseMeasurementsCsv('fecha,unidad,valor,valor\n', avail, ctx).errors.at(-1).message, /repetidas/);
  assert.match(parseMeasurementsCsv('x'.repeat(1024 * 1024 + 1), avail, ctx).errors[0].message, /1 MB/);
  const many = 'fecha,unidad,valor\n' + '2027-01-01,u-alfa,1\n'.repeat(CSV_MAX_ROWS + 1);
  assert.match(parseMeasurementsCsv(many, avail, ctx).errors[0].message, /máximo es 5000/);
  const exact = 'fecha,unidad,valor\n' + '2027-01-01,u-alfa,1\n'.repeat(CSV_MAX_ROWS);
  assert.equal(parseMeasurementsCsv(exact, avail, ctx).rows.length, CSV_MAX_ROWS);
  assert.match(parseMeasurementsCsv(42, avail, ctx).errors[0].message, /texto/);
  assert.match(parseMeasurementsCsv('a', {}, ctx).errors[0].message, /tipo de medición/);
  assert.equal(parseMeasurementsCsv('fecha,unidad,valor\n"2027-01-01,u\n', avail, ctx).errors[0].row, 2);
});

test('validateMeasurementInput (formulario): mensajes por campo', () => {
  const ok = validateMeasurementInput(avail, { fecha: '2027-01-15', unidad: 'u-alfa', valor: '99.9' }, ctx);
  assert.equal(ok.ok, true);
  const bad = validateMeasurementInput(avail, { fecha: '', unidad: '', valor: '' }, ctx);
  assert.deepEqual(bad.errors.map((e) => e.field), ['fecha', 'unidad', 'valor']);
  assert.equal(validateMeasurementInput(avail, { fecha: '1999-12-31', unidad: 'u-alfa', valor: '1' }, ctx).ok, false);
  assert.equal(validateMeasurementInput({}, {}, ctx).ok, false);
  // Sin `today` no se rechazan fechas futuras.
  assert.equal(validateMeasurementInput(avail, { fecha: '2099-01-01', unidad: 'u-alfa', valor: '1' }, { units: UNITS }).ok, true);
});
