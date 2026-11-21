// V-07 — engine/xlsx.js, engine/xml.js, engine/zip.js (importación Excel).
// Pruebas del desarrollador. Los .xlsx se arman en memoria (sin fixtures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  parseMeasurementsCsv, parseMeasurementsXlsx, readFirstSheet, excelSerialToIsoDate, columnIndex, columnLetter,
  parseXml, decodeEntities, buildXlsxTemplate, buildStoredZip, crc32, listZipEntries, CSV_MAX_ROWS,
  XLSX_MAX_PART_BYTES, resolvePartPath, decodeOoxmlEscapes,
} from '../../engine/index.js';
import { inflateRaw } from '../../src/lib/inflate.js';

const UNITS = [{ id: 'u-alfa', name: 'Unidad Alfa' }, { id: 'u-beta', name: 'Unidad Beta' }];
const avail = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
const obs = { measurementType: 'coverage', direction: 'higher_is_better', thresholds: { green: 90, yellow: 75 } };
const vuln = {
  measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 },
  thresholdsByCategory: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
};
const ctx = { units: UNITS, today: '2027-02-15' };
const enc = new TextEncoder();
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PREL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** ZIP con deflate (zlib) o sin comprimir; `lie` permite declarar otro tamaño. */
function zip(files, { store = false, lie = {} } = {}) {
  const parts = [];
  const cen = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = typeof text === 'string' ? enc.encode(text) : text;
    const comp = store ? data : deflateRawSync(data);
    const n = enc.encode(name);
    const size = lie[name] ?? data.length;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(store ? 0 : 8, 8);
    loc.writeUInt32LE(crc32(data), 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(size, 22); loc.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(off, 42);
    parts.push(loc, n, comp);
    cen.push(c, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(cen);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, e]));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
/** Celda: string → texto compartido; number → numérica; {f} → fórmula; {e} → error; {inline} → inlineStr. */
function sheetXml(rows, shared) {
  const body = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((v, i) => {
    const ref = `${columnLetter(i)}${r + 1}`;
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
    if (v.f) return `<c r="${ref}"><f>${esc(v.f)}</f><v>1</v></c>`;
    if (v.e) return `<c r="${ref}" t="e"><v>${esc(v.e)}</v></c>`;
    if (v.inline !== undefined) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v.inline)}</t></is></c>`;
    let idx = shared.indexOf(v);
    if (idx === -1) { shared.push(v); idx = shared.length - 1; }
    return `<c r="${ref}" t="s"><v>${idx}</v></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData>${body}</sheetData></worksheet>`;
}

function xlsx(rows, { date1904 = false, extra = {}, sheet, store } = {}) {
  const shared = [];
  const s = sheet ?? sheetXml(rows, shared);
  return zip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels': `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="${REL}">${date1904 ? '<workbookPr date1904="1"/>' : ''}`
      + '<sheets><sheet name="Datos" sheetId="1" r:id="rId1"/><sheet name="Otra" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PREL}">`
      + `<Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/>`
      + `<Relationship Id="rId1" Type="${REL}/worksheet" Target="/xl/worksheets/sheet1.xml"/>`
      + `<Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': s,
    'xl/worksheets/sheet2.xml': sheetXml([['otra hoja']], []),
    'xl/sharedStrings.xml': `<sst xmlns="${NS}">${shared.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('')}</sst>`,
    ...extra,
  }, { store });
}

const parseX = (bytes, ind = avail) => parseMeasurementsXlsx(bytes, ind, ctx, inflateRaw);

test('excelSerialToIsoDate: sistema 1900 con el 29-feb-1900 ficticio y sistema 1904', () => {
  assert.equal(excelSerialToIsoDate(1), '1900-01-01');
  assert.equal(excelSerialToIsoDate(59), '1900-02-28');
  assert.equal(excelSerialToIsoDate(60), null);
  assert.equal(excelSerialToIsoDate(61), '1900-03-01');
  assert.equal(excelSerialToIsoDate(45658), '2025-01-01');
  assert.equal(excelSerialToIsoDate(46327), '2026-11-01');
  // La hora no mueve el día (fecha local de Guayaquil, sin desplazamiento).
  assert.equal(excelSerialToIsoDate(46327.99999), '2026-11-01');
  assert.equal(excelSerialToIsoDate(0, true), '1904-01-01');
  assert.equal(excelSerialToIsoDate(46327 - 1462, true), '2026-11-01');
  for (const bad of [0, -1, NaN, Infinity, 3e6, '46327']) assert.equal(excelSerialToIsoDate(bad), null, String(bad));
});

test('columnIndex y columnLetter', () => {
  assert.equal(columnIndex('A1'), 0);
  assert.equal(columnIndex('Z9'), 25);
  assert.equal(columnIndex('AA10'), 26);
  assert.equal(columnIndex('1A'), -1);
  assert.equal(columnLetter(0), 'A');
  assert.equal(columnLetter(27), 'AB');
});

test('el .xlsx importa igual que su CSV (window_average, fechas de serie y texto)', async () => {
  const csv = 'fecha,unidad,valor\n2026-11-01,Unidad Alfa,99.95\n2026-11-02,unidad beta,"99,5"\n2026-11-03,u-alfa,100\n';
  const book = xlsx([
    ['fecha', 'unidad', 'valor'],
    [46327, 'Unidad Alfa', 99.95],
    [{ inline: '2026-11-02' }, 'unidad beta', '99,5'],
    [46329.5, 'u-alfa', 100],
  ]);
  const a = parseMeasurementsCsv(csv, avail, ctx);
  const b = await parseX(book);
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b, a);
});

test('el .xlsx importa igual que su CSV (coverage con booleanos y cumulative_target)', async () => {
  const csvCov = 'fecha,unidad,app_id,cumple\n2026-11-01,Unidad Alfa,app-1,true\n2026-11-01,Unidad Alfa,1234,no\n';
  const xCov = xlsx([['fecha', 'unidad', 'app_id', 'cumple'], [46327, 'Unidad Alfa', 'app-1', true], [46327, 'Unidad Alfa', 1234, 'no']]);
  assert.deepEqual(await parseX(xCov, obs), parseMeasurementsCsv(csvCov, obs, ctx));

  const csvV = 'Fecha,Unidad,Valor,Categoría\n2026-11-01,Unidad Alfa,3,P0P1\n';
  const xV = xlsx([['Fecha', 'Unidad', 'Valor', 'Categoría'], [46327, 'Unidad Alfa', 3, 'P0P1']]);
  const r = await parseX(xV, vuln);
  assert.deepEqual(r, parseMeasurementsCsv(csvV, vuln, ctx));
  assert.equal(r.rows[0].kind, 'resolved');
});

test('lee la primera hoja según workbook.xml, también sin comprimir', async () => {
  const book = xlsx([['fecha', 'unidad', 'valor'], [46327, 'Unidad Alfa', 1]], { store: true });
  const { rows } = await readFirstSheet(book, inflateRaw);
  assert.equal(rows[0].cells[0].value, 'fecha');
});

test('sistema de fechas 1904', async () => {
  const r = await parseX(xlsx([['fecha', 'unidad', 'valor'], [46327 - 1462, 'Unidad Alfa', 1]], { date1904: true }));
  assert.equal(r.rows[0].date, '2026-11-01');
});

test('filas vacías se ignoran y los números de fila son los de Excel', async () => {
  const is = (ref, t) => `<c r="${ref}" t="inlineStr"><is><t>${t}</t></is></c>`;
  const sheet = `<worksheet xmlns="${NS}"><sheetData>`
    + `<row r="1">${is('A1', 'fecha')}${is('B1', 'unidad')}${is('C1', 'valor')}</row>`
    + '<row r="2"><c r="A2" s="1"/></row>'
    + `<row r="5"><c r="A5"><v>46327</v></c>${is('B5', 'Unidad Alfa')}<c r="C5"><v>1</v></c></row>`
    + '</sheetData></worksheet>';
  const r = await parseX(xlsx(null, { sheet }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows[0].line, 5);
  assert.equal(r.rows[0].date, '2026-11-01');
});

test('celdas con fórmula o error de Excel se rechazan con fila y columna', async () => {
  const r = await parseX(xlsx([['fecha', 'unidad', 'valor'], [46327, 'Unidad Alfa', { f: 'SUM(1,2)' }], [{ e: '#N/A' }, 'Unidad Alfa', 1]]));
  assert.deepEqual(r.rows, []);
  assert.equal(r.errors.length, 2);
  assert.deepEqual(r.errors[0].row, 2);
  assert.match(r.errors[0].message, /Columna C: .*fórmula/);
  assert.equal(r.errors[1].row, 3);
  assert.match(r.errors[1].message, /Columna A: .*error de Excel \(#N\/A\)/);
});

test('texto que parece fórmula también se rechaza (igual que en el CSV)', async () => {
  const r = await parseX(xlsx([['fecha', 'unidad', 'valor'], [46327, '=HYPERLINK("x")', 1]]));
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0].message, /posible fórmula/);
});

test('columnas erróneas: mismos mensajes que el CSV', async () => {
  const csv = parseMeasurementsCsv('fecha,unidad,monto\n2026-11-01,Unidad Alfa,1\n', avail, ctx);
  const x = await parseX(xlsx([['fecha', 'unidad', 'monto'], [46327, 'Unidad Alfa', 1]]));
  assert.deepEqual(x, csv);
  assert.match(x.errors[0].message, /faltan columnas valor/);
});

test('fila con datos fuera de la cabecera se rechaza', async () => {
  const r = await parseX(xlsx([['fecha', 'unidad', 'valor'], [46327, 'Unidad Alfa', 1, 'extra']]));
  assert.match(r.errors[0].message, /Tiene 4 columnas y la cabecera 3/);
});

test('límites: más de 1 MB y más de 5000 filas', async () => {
  const big = new Uint8Array(1024 * 1024 + 1);
  big.set([0x50, 0x4b, 0x03, 0x04]);
  assert.equal((await parseX(big)).errors[0].message, 'El archivo supera 1 MB');

  const rows = [['fecha', 'unidad', 'valor']];
  for (let i = 0; i <= CSV_MAX_ROWS; i++) rows.push([46327, 'Unidad Alfa', 1]);
  const r = await parseX(xlsx(rows));
  assert.equal(r.errors[0].message, `El archivo tiene ${CSV_MAX_ROWS + 1} filas; el máximo es ${CSV_MAX_ROWS}`);
});

test('zip bomb: tamaño declarado excesivo o real mayor que el declarado se rechaza', async () => {
  const huge = new Uint8Array(XLSX_MAX_PART_BYTES + 10); // ceros: comprime a pocos KB
  const declared = xlsx(null, { sheet: 'x', extra: { 'xl/worksheets/sheet1.xml': huge } });
  assert.match((await parseX(declared)).errors[0].message, /demasiado grande al descomprimir/);

  // Declara 10 bytes pero se expande a más de 8 MiB: lo corta el inflate.
  const files = {
    '_rels/.rels': `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': huge,
  };
  const lying = zip(files, { lie: { 'xl/worksheets/sheet1.xml': 10 } });
  assert.ok(lying.length < 1024 * 1024);
  const r = await parseX(lying);
  assert.match(r.errors[0].message, /demasiado grande al descomprimir/);
});

test('inflateRaw corta al superar el tope con code=limit', async () => {
  const comp = new Uint8Array(deflateRawSync(new Uint8Array(100000)));
  assert.equal((await inflateRaw(comp, 100000)).length, 100000);
  await assert.rejects(inflateRaw(comp, 1000), (e) => e.code === 'limit');
});

test('XML malicioso: DOCTYPE/ENTITY, entidades desconocidas y anidamiento se rechazan', async () => {
  assert.throws(() => parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>'), /DOCTYPE/);
  assert.throws(() => parseXml('<a>&x;</a>'), /entidad/);
  assert.throws(() => parseXml('<a>a & b</a>'), /mal formado/);
  assert.throws(() => parseXml('<a b="1" b="2"/>'), /repetido/);
  assert.throws(() => parseXml(`${'<a>'.repeat(100)}${'</a>'.repeat(100)}`), /anidamiento/);
  assert.throws(() => parseXml('<a><b></a></b>'), /orden/);
  assert.equal(decodeEntities('&lt;&#65;&#x42;&amp;'), '<AB&');
  const doc = parseXml('<a __proto__="x"><b>t</b></a>');
  assert.equal(Object.getPrototypeOf(doc.children[0].attrs), null);

  const bomb = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]>'
    + `<worksheet xmlns="${NS}"><sheetData><row><c t="inlineStr"><is><t>&lol2;</t></is></c></row></sheetData></worksheet>`;
  const r = await parseX(xlsx(null, { sheet: bomb }));
  assert.match(r.errors[0].message, /DOCTYPE/);
});

test('archivos que no son .xlsx: .xls antiguo, texto, ZIP dañado', async () => {
  const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.match((await parseX(xls)).errors[0].message, /Excel antiguo \(\.xls\)/);
  assert.match((await parseX(enc.encode('fecha,unidad,valor'))).errors[0].message, /no es un libro de Excel/);
  const book = xlsx([['fecha']]);
  const cut = book.slice(0, book.length - 30);
  assert.match((await parseX(cut)).errors[0].message, /dañado/);
  const flipped = xlsx([['fecha', 'unidad', 'valor'], [46327, 'Unidad Alfa', 1]], { store: true });
  const i = flipped.indexOf(0x3c, 200); // un "<" de algún XML
  flipped[i] = 0x3e;
  assert.match((await parseX(flipped)).errors[0].message, /CRC|dañado/);
});

test('ZIP: cifrado y nombres repetidos se rechazan', () => {
  const book = buildStoredZip([{ name: 'a.xml', data: enc.encode('<a/>') }, { name: 'a.xml', data: enc.encode('<a/>') }]);
  assert.throws(() => listZipEntries(book), /repetidas/);
  const one = buildStoredZip([{ name: 'a.xml', data: enc.encode('<a/>') }]);
  const cdStart = one.length - 22 - (46 + 5);
  one[cdStart + 8] |= 1;
  assert.throws(() => listZipEntries(one), /cifrado/);
});

test('resolvePartPath y escapes _xHHHH_', () => {
  assert.equal(resolvePartPath('xl/', 'worksheets/sheet1.xml'), 'xl/worksheets/sheet1.xml');
  assert.equal(resolvePartPath('xl/', '/xl/worksheets/s.xml'), 'xl/worksheets/s.xml');
  assert.equal(resolvePartPath('xl/', '../x.xml'), 'x.xml');
  assert.equal(resolvePartPath('', '../../x.xml'), null);
  assert.equal(decodeOoxmlEscapes('a_x000D_b'), 'a\rb');
});

test('plantilla .xlsx: se lee de vuelta con la cabecera del tipo', async () => {
  const cols = ['fecha', 'unidad', 'valor', 'categoria', 'tipo'];
  const tpl = buildXlsxTemplate(cols);
  const { rows } = await readFirstSheet(tpl, inflateRaw);
  assert.deepEqual(rows[0].cells.map((c) => c.value), cols);
  assert.equal((await parseX(tpl, vuln)).errors[0].message, 'El archivo no tiene filas de datos');
});
