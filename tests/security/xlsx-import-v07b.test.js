// V-07b — Pruebas de seguridad de los ajustes a la importación .xlsx (ADR 0018):
// tope de inflado min(maxBytes, entry.size) (H-V07-01), corte de la hoja al pasar
// de CSV_MAX_ROWS + 1 filas con procesado fila a fila (H-V07-02), mensaje de
// negativos (QA-V07-1) y redondeo de fechas de serie (QA-V07-2).
//
// Todos los archivos maliciosos se fabrican aquí, en memoria, con un armador de
// ZIP propio de la prueba que permite mentir en el tamaño declarado.
//
// Categoría 3 (entradas): zip bombs con tamaño declarado mentiroso, hojas con
// muchas filas, filas enormes, XML profundo o mal formado tras el corte, filas
// fuera de la primera sheetData, onClose no evadible, negativos y fórmulas en
// `valor`, series de fecha extremas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  parseMeasurementsXlsx, parseMeasurementsCsv, validateMeasurementInput, parseSheet, parseXml,
  excelSerialToIsoDate, readZipEntry, crc32, XmlError, CSV_MAX_ROWS, XLSX_MAX_PART_BYTES, XLSX_MAX_SHEET_ROWS,
} from '../../engine/index.js';
import { inflateRaw } from '../../src/lib/inflate.js';

const enc = new TextEncoder();
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PREL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const UNITS = [{ id: 'u-alfa', name: 'Unidad Alfa' }];
const AVAIL = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
const VULN = {
  measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 },
  thresholdsByCategory: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
};
const CTX = { units: UNITS, today: '2027-02-15' };
const MiB = 1024 * 1024;

/** ZIP con tamaños declarados a elección: { name, data, size?, method? }. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let off = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const method = e.method ?? 8;
    const comp = method === 8 ? new Uint8Array(deflateRawSync(data, { level: 9 })) : data;
    const crc = e.crc ?? crc32(data);
    const size = e.size ?? data.length;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(size, 22);
    loc.writeUInt16LE(nameBytes.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(size, 24);
    c.writeUInt16LE(nameBytes.length, 28); c.writeUInt32LE(off, 42);
    locals.push(loc, nameBytes, comp);
    centrals.push(c, nameBytes);
    off += 30 + nameBytes.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

const parts = (sheetXml, sheetOver = {}) => [
  { name: '[Content_Types].xml', data: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
  { name: '_rels/.rels', data: `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
  { name: 'xl/workbook.xml', data: `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="M" sheetId="1" r:id="rId1"/></sheets></workbook>` },
  { name: 'xl/_rels/workbook.xml.rels', data: `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
  { name: 'xl/worksheets/sheet1.xml', data: sheetXml, ...sheetOver },
];
const HEADER = '<row r="1"><c t="inlineStr"><is><t>fecha</t></is></c><c t="inlineStr"><is><t>unidad</t></is></c><c t="inlineStr"><is><t>valor</t></is></c></row>';
const dataRow = (r, v = '99.95') => `<row r="${r}"><c t="inlineStr"><is><t>2027-01-10</t></is></c><c t="inlineStr"><is><t>Unidad Alfa</t></is></c><c><v>${v}</v></c></row>`;
const ws = (body) => `<worksheet xmlns="${NS}"><sheetData>${body}</sheetData></worksheet>`;
const rowsXml = (n, from = 2) => { let s = ''; for (let r = from; r < from + n; r++) s += dataRow(r); return s; };

async function run(bytes, indicator = AVAIL, inflate = inflateRaw) {
  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (u) => { fetched.push(String(u)); throw new Error('red prohibida'); };
  try {
    const t0 = Date.now();
    const res = await parseMeasurementsXlsx(bytes, indicator, CTX, inflate);
    return { ...res, ms: Date.now() - t0, fetched };
  } finally {
    globalThis.fetch = realFetch;
  }
}
const msgs = (res) => res.errors.map((e) => e.message).join(' | ');
const rejected = (res, re) => {
  assert.equal(res.rows.length, 0, 'no debe quedar ninguna fila para guardar');
  assert.ok(res.errors.length > 0, 'debe haber errores');
  assert.deepEqual(res.fetched, [], 'sin red');
  if (re) assert.match(msgs(res), re);
};
/** inflate espía: registra el tope pedido y cuántos bytes produjo de verdad. */
function spy() {
  const s = { caps: [], produced: 0 };
  s.fn = async (data, max) => {
    s.caps.push(max);
    try {
      const out = await inflateRaw(data, max);
      s.produced += out.length;
      return out;
    } catch (err) {
      s.produced += max; // como mucho el tope (+ un bloque)
      throw err;
    }
  };
  return s;
}

// ---------------------------------------------------------------------------
// H-V07-01: tope de inflado = min(maxBytes, tamaño declarado)
// ---------------------------------------------------------------------------

test('cat 3: zip bomb de 100 MiB que declara 2 KB: el descompresor recibe tope 2 KB y el archivo se rechaza como dañado', async () => {
  const bomb = new Uint8Array(100 * MiB).fill(0x20);
  const s = spy();
  const res = await run(zip(parts(bomb, { size: 2048, crc: 0 })), AVAIL, s.fn);
  rejected(res, /dañado|demasiado grande/);
  assert.ok(s.caps.includes(2048), `el tope pasado debe ser el declarado (2048); se pasó ${s.caps}`);
  assert.ok(Math.max(...s.caps) <= XLSX_MAX_PART_BYTES);
  assert.ok(res.ms < 3000, `debe cortar pronto (${res.ms} ms)`);
});

test('cat 3: tamaño declarado 0 con datos deflate que sí producen bytes se corta con tope 0', async () => {
  const s = spy();
  const res = await run(zip(parts(ws(HEADER + rowsXml(1)), { size: 0, crc: 0 })), AVAIL, s.fn);
  rejected(res, /dañado|vacío|demasiado/);
  assert.ok(s.caps.includes(0), `tope 0 para la hoja; topes: ${s.caps}`);
});

test('cat 3: tamaño declarado 1 byte menor que el real se rechaza (no se acepta "casi")', async () => {
  const xml = ws(HEADER + rowsXml(3));
  const res = await run(zip(parts(xml, { size: enc.encode(xml).length - 1 })));
  rejected(res, /dañado/);
});

test('cat 3: tamaño declarado mayor que el real (mentira hacia arriba) se rechaza por tamaño distinto y no amplía el tope', async () => {
  const xml = ws(HEADER + rowsXml(3));
  const s = spy();
  const res = await run(zip(parts(xml, { size: enc.encode(xml).length + 1000 })), AVAIL, s.fn);
  rejected(res, /dañado/);
  assert.ok(Math.max(...s.caps) <= XLSX_MAX_PART_BYTES);
});

test('cat 3: tamaño declarado mayor que 8 MiB se rechaza ANTES de llamar al descompresor', async () => {
  const s = spy();
  const res = await run(zip(parts(ws(HEADER), { size: XLSX_MAX_PART_BYTES + 1 })), AVAIL, s.fn);
  rejected(res, /demasiado grande/);
  assert.equal(s.caps.length, 3, 'la hoja no llega a descomprimirse (solo .rels, workbook y sus rels)');
  assert.ok(!s.caps.some((c) => c > XLSX_MAX_PART_BYTES));
});

test('cat 3: readZipEntry nunca pasa al inflate un tope mayor que el declarado ni que maxBytes', async () => {
  const data = enc.encode('x'.repeat(5000));
  const raw = new Uint8Array(deflateRawSync(data));
  const bytes = new Uint8Array(raw.length);
  bytes.set(raw);
  const caps = [];
  const fake = async (_d, max) => { caps.push(max); return new Uint8Array(max + 10); }; // inflate hostil que ignora el tope
  for (const [size, maxBytes] of [[100, 8 * MiB], [8 * MiB, 1000], [500, 1000], [0, 50]]) {
    await assert.rejects(readZipEntry(bytes, { method: 8, crc: 0, compressedSize: raw.length, size, dataStart: 0 }, fake, maxBytes));
  }
  // 8 MiB declarados con tope 1000: se rechaza antes de llamar al inflate.
  assert.deepEqual(caps, [100, 500, 0]);
});

// ---------------------------------------------------------------------------
// H-V07-02: corte de la hoja y procesado por fila
// ---------------------------------------------------------------------------

test('cat 3: XLSX_MAX_SHEET_ROWS es cabecera + CSV_MAX_ROWS + 1', () => {
  assert.equal(XLSX_MAX_SHEET_ROWS, CSV_MAX_ROWS + 2);
});

test('cat 3: frontera — cabecera + 5000 filas se acepta; + 5001 da el mensaje del CSV; + 5002 corta en la lectura', async () => {
  const ok = await run(zip(parts(ws(HEADER + rowsXml(CSV_MAX_ROWS)))));
  assert.equal(ok.errors.length, 0, msgs(ok));
  assert.equal(ok.rows.length, CSV_MAX_ROWS);
  const over1 = await run(zip(parts(ws(HEADER + rowsXml(CSV_MAX_ROWS + 1)))));
  rejected(over1, /5001 filas/);
  const over2 = await run(zip(parts(ws(HEADER + rowsXml(CSV_MAX_ROWS + 2)))));
  rejected(over2, /más de 5001 filas/);
});

test('cat 3: el corte ocurre sin analizar el resto: XML roto, DOCTYPE o anidamiento extremo tras la fila 5003 no se llegan a leer', async () => {
  const tails = {
    'XML mal formado': '<row r="999999"><c><v>1</v></row></worksheet>',
    'DOCTYPE/ENTITY': '<!DOCTYPE x [<!ENTITY a "aaaa">]>',
    'anidamiento 100 000': '<x>'.repeat(100000),
  };
  for (const [name, tail] of Object.entries(tails)) {
    const xml = `<worksheet xmlns="${NS}"><sheetData>${HEADER}${rowsXml(CSV_MAX_ROWS + 2)}${tail}`;
    const res = await run(zip(parts(xml)));
    rejected(res, /más de 5001 filas/);
    assert.doesNotMatch(msgs(res), /XML|anidamiento|DOCTYPE/, name);
  }
});

test('cat 3: hoja de ~8 MiB con 300 000 filas se corta en la fila 5003 en tiempo acotado', async () => {
  let body = HEADER;
  for (let r = 2; body.length < XLSX_MAX_PART_BYTES - 200; r++) body += `<row r="${r}"><c><v>1</v></c></row>`;
  const res = await run(zip(parts(ws(body))));
  rejected(res, /más de 5001 filas/);
  assert.ok(res.ms < 3000, `${res.ms} ms`);
});

test('cat 3: filas vacías no cuentan para el tope pero siguen acotadas por el tope de elementos y no se retienen', async () => {
  // 380 000 filas autocerradas: no hay datos, se recorren todas; el árbol no las guarda.
  let body = HEADER + dataRow(2);
  for (let r = 3; r < 380000; r++) body += `<row r="${r}"/>`;
  const xml = ws(body);
  assert.ok(xml.length < XLSX_MAX_PART_BYTES);
  const t0 = Date.now();
  const rows = parseSheet(xml, []);
  assert.equal(rows.length, 2);
  assert.ok(Date.now() - t0 < 3000);
  // Con más de XML_MAX_ELEMENTS elementos sigue cortando por complejidad.
  let big = HEADER;
  for (let r = 2; r < 420000; r++) big += `<row r="${r}"/>`;
  assert.throws(() => parseSheet(ws(big), []), XmlError);
});

test('cat 3: el árbol de la hoja no retiene las filas procesadas (memoria acotada a una fila)', () => {
  const xml = ws(HEADER + rowsXml(50));
  let sheetData = null;
  const doc = parseXml(xml, {
    onClose: (node, stack) => {
      if (stack.length === 3 && node.name === 'row') { sheetData = stack[2]; stack[2].children.pop(); }
    },
  });
  assert.ok(doc);
  assert.equal(sheetData.children.filter((c) => typeof c !== 'string').length, 0);
  // Y parseSheet real devuelve las 51 filas aunque el árbol quede vacío.
  assert.equal(parseSheet(xml, []).length, 51);
});

test('cat 3: filas fuera de la primera sheetData (segunda sheetData, otro padre, filas anidadas) no se cuentan como datos ni evaden el tope', async () => {
  const many = rowsXml(CSV_MAX_ROWS + 10);
  // Segunda sheetData con miles de filas: ignorada (como antes de V-07b).
  const second = await run(zip(parts(`<worksheet xmlns="${NS}"><sheetData>${HEADER}${dataRow(2)}</sheetData><sheetData>${many}</sheetData></worksheet>`)));
  assert.equal(second.errors.length, 0, msgs(second));
  assert.equal(second.rows.length, 1);
  // Filas colgadas de otro elemento: no son datos.
  const other = await run(zip(parts(`<worksheet xmlns="${NS}"><sheetData>${HEADER}${dataRow(2)}</sheetData><extLst>${many}</extLst></worksheet>`)));
  assert.equal(other.rows.length, 1);
  // Fila dentro de fila: la interna no se procesa como fila de datos.
  const nested = parseSheet(ws(`${HEADER}<row r="2"><row r="3"><c><v>1</v></c></row><c><v>5</v></c></row>`), []);
  assert.equal(nested.length, 2);
  assert.deepEqual(nested[1].cells.map((c) => c.value), ['5']);
  // Raíz distinta de worksheet con sheetData/row: se rechaza.
  assert.throws(() => parseSheet(`<chartsheet xmlns="${NS}"><sheetData>${HEADER}</sheetData></chartsheet>`, []));
});

test('cat 3: prefijos de espacio de nombres (x:row, x:sheetData) también se cortan', () => {
  let body = '';
  for (let r = 1; r <= CSV_MAX_ROWS + 3; r++) body += `<x:row r="${r}"><x:c><x:v>1</x:v></x:c></x:row>`;
  assert.throws(() => parseSheet(`<x:worksheet xmlns:x="${NS}"><x:sheetData>${body}</x:sheetData></x:worksheet>`, []), /más de 5001 filas/);
});

test('cat 3: filas fuera de orden o con r inválido se detectan durante el procesado por fila', () => {
  for (const r of ['0', '-1', 'abc', '1048577', '2']) {
    assert.throws(() => parseSheet(ws(`${HEADER}<row r="2"><c><v>1</v></c></row><row r="${r}"><c><v>1</v></c></row>`), []), /dañado/, r);
  }
});

test('cat 3: fila enorme (una celda de ~7 MiB, o miles de celdas) se rechaza o acota sin colgar', async () => {
  const huge = `<row r="2"><c t="inlineStr"><is><t>${'A'.repeat(7 * MiB)}</t></is></c></row>`;
  const r1 = await run(zip(parts(ws(HEADER + huge))));
  rejected(r1);
  assert.ok(r1.ms < 5000, `${r1.ms} ms`);
  let cells = '';
  for (let c = 0; c < 120000; c++) cells += '<c><v>1</v></c>';
  const r2 = await run(zip(parts(ws(`${HEADER}<row r="2">${cells}</row>`))));
  rejected(r2, /columnas|complejo/);
  assert.ok(r2.ms < 5000, `${r2.ms} ms`);
});

test('cat 3: XML profundo dentro de una fila sigue cortado por XML_MAX_DEPTH, sin desbordar la pila', async () => {
  const deep = `<row r="2"><c t="inlineStr"><is>${'<r>'.repeat(200000)}`;
  const res = await run(zip(parts(ws(HEADER + deep))));
  rejected(res, /anidamiento|complejo/);
});

test('cat 3: un onClose que lanza no deja estado a medias (dos lecturas seguidas dan el mismo resultado)', async () => {
  const bytes = zip(parts(ws(HEADER + rowsXml(CSV_MAX_ROWS + 5))));
  const a = await run(bytes);
  const b = await run(bytes);
  assert.deepEqual(a.errors, b.errors);
  const ok = await run(zip(parts(ws(HEADER + rowsXml(2)))));
  assert.equal(ok.rows.length, 2);
});

// ---------------------------------------------------------------------------
// QA-V07-1: mensaje de negativos — sigue rechazando y no abre la puerta a fórmulas
// ---------------------------------------------------------------------------

test('cat 3: negativos simples en valor se rechazan con el mensaje ≥ 0; fórmulas que empiezan con "-" siguen como fórmula', () => {
  for (const v of ['-5', '-0,5', '-0.25', ' -7 ']) {
    const r = validateMeasurementInput(AVAIL, { fecha: '2027-01-10', unidad: 'Unidad Alfa', valor: v }, CTX);
    assert.equal(r.ok, false, v);
    assert.match(r.errors.map((e) => e.message).join(' '), /≥ 0/, v);
  }
  const rv = validateMeasurementInput(VULN, { fecha: '2027-01-10', unidad: 'Unidad Alfa', valor: '-3', categoria: 'P0P1' }, CTX);
  assert.equal(rv.ok, false);
  assert.match(rv.errors.map((e) => e.message).join(' '), /entero ≥ 0/);
  for (const v of ['-1+1', '-2+3+cmd|\' /C calc\'!A0', '-SUM(A1)', '-1e5', '--5', '-5;=1', '-0x10']) {
    const r = validateMeasurementInput(AVAIL, { fecha: '2027-01-10', unidad: 'Unidad Alfa', valor: v }, CTX);
    assert.equal(r.ok, false, v);
    assert.match(r.errors.map((e) => e.message).join(' '), /fórmula/, v);
  }
  // En otros campos "-5" sigue siendo posible fórmula.
  const rf = validateMeasurementInput(AVAIL, { fecha: '-5', unidad: 'Unidad Alfa', valor: '1' }, CTX);
  assert.match(rf.errors.map((e) => e.message).join(' '), /fórmula/);
});

test('cat 3: el negativo no llega al insert ni por CSV ni por Excel', async () => {
  const csv = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,Unidad Alfa,-5\n', AVAIL, CTX);
  assert.equal(csv.rows.length, 0);
  const x = await run(zip(parts(ws(HEADER + dataRow(2, '-5')))));
  rejected(x, /≥ 0/);
});

// ---------------------------------------------------------------------------
// QA-V07-2: redondeo de fechas de serie
// ---------------------------------------------------------------------------

test('cat 3: series de fecha extremas o raras devuelven null o una fecha válida, nunca lanzan', () => {
  const weird = [NaN, Infinity, -Infinity, -0, -1e-9, 1e308, -1e308, Number.MAX_VALUE, Number.MIN_VALUE, 2958465.9999999,
    2958466, 2958466.5, 60, 59.9999999999, 60.0000000001, 1e-9, 0.5, '46028', null, undefined, {}, 46028n];
  for (const s of weird) {
    for (const d1904 of [false, true]) {
      const out = excelSerialToIsoDate(s, d1904);
      assert.ok(out === null || /^\d{4}-\d{2}-\d{2}$/.test(out), `${String(s)} → ${out}`);
    }
  }
  assert.equal(excelSerialToIsoDate(46028 - 1e-9), '2026-01-06');
  assert.equal(excelSerialToIsoDate(46028.9999), '2026-01-06');
  assert.equal(excelSerialToIsoDate(2958466), null);
  assert.equal(excelSerialToIsoDate(1e308), null);
});
