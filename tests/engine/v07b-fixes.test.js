// V-07b — hallazgos bajos de V-07 (H-V07-01, H-V07-02, QA-V07-1, QA-V07-2).
// Pruebas del desarrollador. Los .xlsx se arman en memoria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  parseMeasurementsXlsx, parseMeasurementsCsv, validateMeasurementInput, excelSerialToIsoDate, parseSheet, parseXml,
  readZipEntry, listZipEntries, crc32, CSV_MAX_ROWS, XLSX_MAX_SHEET_ROWS, XLSX_MAX_PART_BYTES, XmlError,
} from '../../engine/index.js';
import { inflateRaw } from '../../src/lib/inflate.js';

const UNITS = [{ id: 'u-alfa', name: 'Unidad Alfa' }];
const ctx = { units: UNITS, today: '2027-02-15' };
const avail = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
const vuln = {
  measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 },
  thresholdsByCategory: { P0P1: { green: 96, yellow: 90 } },
};
const enc = new TextEncoder();
const DAY = 86400000;
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PREL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** ZIP deflate; `lie` declara otro tamaño descomprimido por nombre. */
function zip(files, lie = {}) {
  const parts = [];
  const cen = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = typeof text === 'string' ? enc.encode(text) : text;
    const comp = deflateRawSync(data);
    const n = enc.encode(name);
    const size = lie[name] ?? data.length;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(8, 8);
    loc.writeUInt32LE(crc32(data), 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(size, 22); loc.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(off, 42);
    parts.push(loc, n, comp);
    cen.push(c, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(cen);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, eocd]));
}

const cell = (v) => (typeof v === 'number' ? `<c><v>${v}</v></c>` : `<c t="inlineStr"><is><t>${v}</t></is></c>`);
const sheetXml = (rows) => `<worksheet xmlns="${NS}"><sheetData>${rows.map((r) => `<row>${r.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`;
function book(sheet, lie = {}) {
  return zip({
    '_rels/.rels': `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheet,
  }, lie);
}
const parseX = (bytes, ind = avail, inflate = inflateRaw) => parseMeasurementsXlsx(bytes, ind, ctx, inflate);

// ---------------------------------------------------------------- H-V07-01

test('H-V07-01: el descompresor recibe como tope el tamaño declarado si es menor que el tope de parte', async () => {
  const caps = [];
  const spy = (data, max) => { caps.push(max); return inflateRaw(data, max); };
  const r = await parseX(book(sheetXml([['fecha', 'unidad', 'valor'], [46327, 'Unidad Alfa', 99.95]])), avail, spy);
  assert.deepEqual(r.errors, []);
  assert.equal(caps.length, 4);
  for (const c of caps) assert.ok(c < 1024, `tope ${c} debería ser el tamaño declarado, no ${XLSX_MAX_PART_BYTES}`);
});

test('H-V07-01: una entrada que declara 2 KB y se expande a 100 MiB se corta a ~2 KB y se informa como dañada', async () => {
  const bomb = new Uint8Array(100 * 1024 * 1024);
  const bytes = book(bomb, { 'xl/worksheets/sheet1.xml': 2048 });
  const entry = listZipEntries(bytes).get('xl/worksheets/sheet1.xml');
  let delivered = 0;
  let cap = -1;
  const spy = async (data, max) => {
    cap = max;
    try { return await inflateRaw(data, max); } catch (e) { delivered = max; throw e; }
  };
  await assert.rejects(readZipEntry(bytes, entry, spy, XLSX_MAX_PART_BYTES), (e) => e.code === 'invalid' && /dañado/.test(e.message) && /demasiado grande al descomprimir/.test(e.message));
  assert.equal(cap, 2048);
  assert.equal(delivered, 2048);
});

test('H-V07-01: si el tamaño declarado es exactamente el tope, superar el tope sigue siendo "demasiado grande" (code limit)', async () => {
  const entry = { method: 8, crc: 0, compressedSize: 1, size: 100, dataStart: 0 };
  const inflate = async () => { throw Object.assign(new Error('x'), { code: 'limit' }); };
  await assert.rejects(readZipEntry(new Uint8Array(1), entry, inflate, 100), (e) => e.code === 'limit' && /demasiado grande/.test(e.message));
});

test('H-V07-01: un descompresor que ignora el tope y entrega más que lo declarado se rechaza por tamaño', async () => {
  const data = enc.encode('<a/>');
  const entry = { method: 8, crc: crc32(data), compressedSize: 1, size: 2, dataStart: 0 };
  await assert.rejects(readZipEntry(new Uint8Array(1), entry, async () => data, 100), /dañado/);
});

// ---------------------------------------------------------------- QA-V07-1

test('QA-V07-1: número negativo en una celda numérica de Excel dice "debe ser un número ≥ 0", no "posible fórmula"', async () => {
  const r = await parseX(book(sheetXml([['fecha', 'unidad', 'valor'], [46327, 'Unidad Alfa', -5]])));
  assert.deepEqual(r.rows, []);
  assert.equal(r.errors[0].row, 2);
  assert.match(r.errors[0].message, /^valor: "-5" debe ser un número ≥ 0/);
  assert.doesNotMatch(r.errors[0].message, /posible fórmula/);
});

test('QA-V07-1: decimal negativo y entero negativo (vulnerabilidades); CSV y Excel dan el mismo mensaje', async () => {
  const r = validateMeasurementInput(avail, { fecha: '2027-01-10', unidad: 'Unidad Alfa', valor: '-0,5' }, ctx);
  assert.deepEqual(r.errors, [{ field: 'valor', message: 'valor: "-0,5" debe ser un número ≥ 0 (no se aceptan negativos ni fórmulas)' }]);
  const v = validateMeasurementInput(vuln, { fecha: '2027-01-10', unidad: 'Unidad Alfa', valor: '-3', categoria: 'P0P1', tipo: 'resuelta' }, ctx);
  assert.equal(v.ok, false);
  assert.match(v.errors.find((e) => e.field === 'valor').message, /debe ser un entero ≥ 0/);
  const csv = parseMeasurementsCsv('fecha,unidad,valor\n2026-11-01,Unidad Alfa,-5\n', avail, ctx);
  const x = await parseX(book(sheetXml([['fecha', 'unidad', 'valor'], [46327, 'Unidad Alfa', -5]])));
  assert.deepEqual(x, csv);
});

test('QA-V07-1: lo que no es un negativo simple sigue siendo "posible fórmula" (en valor y en otras columnas)', () => {
  for (const valor of ['-2+3', '-1e3', '- 5', '=1', '+5']) {
    const r = validateMeasurementInput(avail, { fecha: '2027-01-10', unidad: 'Unidad Alfa', valor }, ctx);
    assert.match(r.errors[0].message, /posible fórmula/, valor);
  }
  const u = validateMeasurementInput(avail, { fecha: '2027-01-10', unidad: '-5', valor: '1' }, ctx);
  assert.match(u.errors[0].message, /unidad: .*posible fórmula/);
});

// ---------------------------------------------------------------- QA-V07-2

test('QA-V07-2: serie a menos de 1 ms de la medianoche se redondea al día siguiente (como Excel)', () => {
  assert.equal(excelSerialToIsoDate(46028 - 1e-9), '2026-01-06');
  assert.equal(excelSerialToIsoDate(46028), '2026-01-06');
  assert.equal(excelSerialToIsoDate(46028 - 1e-9, true), excelSerialToIsoDate(46028, true));
});

test('QA-V07-2: la hora del día se sigue descartando (23:59:59.998 es el mismo día)', () => {
  const almost = 46027 + (DAY - 2) / DAY;
  assert.equal(excelSerialToIsoDate(almost), '2026-01-05');
  assert.equal(excelSerialToIsoDate(46027.5), '2026-01-05');
  assert.equal(excelSerialToIsoDate(61 - 1e-10), '1900-03-01');
  assert.equal(excelSerialToIsoDate(1e300), null);
  assert.equal(excelSerialToIsoDate(-1e300), null);
});

// ---------------------------------------------------------------- H-V07-02

test(`H-V07-02: con más de ${CSV_MAX_ROWS + 1} filas de datos la lectura se corta con un error claro`, async () => {
  assert.equal(XLSX_MAX_SHEET_ROWS, CSV_MAX_ROWS + 2);
  const rows = [['fecha', 'unidad', 'valor'], ...Array.from({ length: CSV_MAX_ROWS + 2 }, () => [46327, 'Unidad Alfa', 1])];
  const r = await parseX(book(sheetXml(rows)));
  assert.deepEqual(r, { rows: [], errors: [{ row: null, message: `El archivo tiene más de ${CSV_MAX_ROWS + 1} filas; el máximo es ${CSV_MAX_ROWS}` }] });
});

test(`H-V07-02: con exactamente ${CSV_MAX_ROWS + 1} filas de datos se conserva el mensaje del CSV`, async () => {
  const rows = [['fecha', 'unidad', 'valor'], ...Array.from({ length: CSV_MAX_ROWS + 1 }, () => [46327, 'Unidad Alfa', 1])];
  const r = await parseX(book(sheetXml(rows)));
  assert.equal(r.errors[0].message, `El archivo tiene ${CSV_MAX_ROWS + 1} filas; el máximo es ${CSV_MAX_ROWS}`);
});

test('H-V07-02: tras el tope no se sigue analizando (un error de XML posterior no se alcanza)', () => {
  const head = sheetXml([['a'], ['b'], ['c'], ['d']]).replace('</sheetData></worksheet>', '');
  const broken = `${head}<row><c t="inlineStr"><is><t>&malo;</t></is></c></row></sheetData></worksheet>`;
  assert.throws(() => parseSheet(broken, [], { maxRows: 3 }), (e) => e.name === 'XlsxError' && /más de 2 filas/.test(e.message));
  // Sin tope que corte, el mismo XML sí falla por la entidad.
  assert.throws(() => parseSheet(broken, [], { maxRows: 100 }), XmlError);
});

test('H-V07-02: filas vacías no cuentan para el tope; las filas procesadas se sueltan del árbol', () => {
  const xml = `<worksheet xmlns="${NS}"><sheetData><row r="1"><c t="inlineStr"><is><t>x</t></is></c></row><row r="2"/><row r="3"><c r="A3" s="1"/></row><row r="4"><c><v>1</v></c></row></sheetData></worksheet>`;
  const rows = parseSheet(xml, [], { maxRows: 2 });
  assert.deepEqual(rows.map((r) => r.line), [1, 4]);
});

test('H-V07-02: solo cuentan filas de la primera sheetData del worksheet', () => {
  const xml = `<worksheet xmlns="${NS}"><sheetData><row r="1"><c><v>1</v></c></row></sheetData><sheetData><row r="1"><c><v>2</v></c></row></sheetData></worksheet>`;
  assert.deepEqual(parseSheet(xml).map((r) => r.cells[0].value), ['1']);
  assert.throws(() => parseSheet(`<foo><sheetData><row r="9"/><row r="2"/></sheetData></foo>`), /estructura inesperada/);
});

test('parseXml: onClose recibe cada elemento al cerrarse (también autocerrados) con su padre en la pila', () => {
  const seen = [];
  parseXml('<a><b/><c><d>t</d></c></a>', { onClose: (n, stack) => seen.push(`${n.name}<${stack[stack.length - 1].name}`) });
  assert.deepEqual(seen, ['b<a', 'd<c', 'c<a', 'a<#document']);
});
