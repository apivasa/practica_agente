// F-11 — Seguridad (categoría 3, inyección de fórmulas) del cambio de numberText en
// engine/xlsx.js: un negativo de Excel en notación científica se expande a decimal y
// se rechaza como "≥ 0". Se comprueba que no abre ninguna vía para colar una fórmula
// ni un valor negativo, y que en CSV el texto -1e3 sigue siendo "posible fórmula".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseMeasurementsXlsx, parseMeasurementsCsv, crc32 } from '../../engine/index.js';
import { inflateRaw } from '../../src/lib/inflate.js';

const UNITS = [{ id: 'u-alfa', name: 'Unidad Alfa' }];
const ctx = { units: UNITS, today: '2027-02-15' };
const avail = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
const vuln = {
  measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 },
  thresholdsByCategory: { P0P1: { green: 96, yellow: 90 } },
};
const enc = new TextEncoder();
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PREL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function zip(files) {
  const parts = [];
  const cen = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = enc.encode(text);
    const comp = deflateRawSync(data);
    const n = enc.encode(name);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(8, 8);
    loc.writeUInt32LE(crc32(data), 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(data.length, 22); loc.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28);
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

const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Celda: { n: '<texto crudo de <v>>' } numérica; string = texto en línea. */
const cell = (v) => (typeof v === 'object' ? `<c><v>${xmlEsc(v.n)}</v></c>` : `<c t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`);
const sheetXml = (rows) => `<worksheet xmlns="${NS}"><sheetData>${rows.map((r) => `<row>${r.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`;
const book = (rows) => zip({
  '_rels/.rels': `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  'xl/worksheets/sheet1.xml': sheetXml(rows),
});
const importRow = (row, ind = avail, header = ['fecha', 'unidad', 'valor']) => parseMeasurementsXlsx(book([header, row]), ind, ctx, inflateRaw);
const importOne = (raw) => importRow([{ n: '46327' }, 'Unidad Alfa', { n: raw }]);
const messages = (r) => r.errors.map((e) => e.message).join(' | ');
const FORMULA = /posible fórmula/;
const csvCell = (v) => `"${v.replace(/"/g, '""')}"`;

// CSV escrito a mano: sin regresión. Lo que empieza por = + - @ (salvo un negativo
// decimal simple, que avisa "≥ 0") sigue siendo posible fórmula.
const CSV_FORMULAS = ['-1e3', '-1E+21', '-1e-3', '-1.5e3', '-1,5e3', '-1e3+cmd', '+1e3', '=1e3', '@1e3',
  '-2+3', '-1+1', '=HYPERLINK("http://x","y")', '-0x10', '-Infinity', '-NaN', '- 1', '-1;2'];
for (const v of CSV_FORMULAS) {
  test(`sec F-11 CSV: valor ${JSON.stringify(v)} → rechazado como posible fórmula, sin filas`, () => {
    const r = parseMeasurementsCsv(`fecha,unidad,valor\n2027-01-10,Unidad Alfa,${csvCell(v)}\n`, avail, ctx);
    assert.equal(r.rows.length, 0);
    assert.match(messages(r), FORMULA, messages(r));
  });
}

for (const v of ['-1e3', '=1e3', '-1E+21']) {
  test(`sec F-11 CSV: ${v} en unidad o categoría → posible fórmula`, () => {
    const r1 = parseMeasurementsCsv(`fecha,unidad,valor\n2027-01-10,${csvCell(v)},99.95\n`, avail, ctx);
    assert.match(messages(r1), FORMULA);
    const r2 = parseMeasurementsCsv(`fecha,unidad,valor,categoria\n2027-01-10,Unidad Alfa,5,${csvCell(v)}\n`, vuln, ctx);
    assert.match(messages(r2), FORMULA);
    assert.equal(r1.rows.length + r2.rows.length, 0);
  });
}

// Excel: celda de texto (inlineStr) = texto escrito a mano → sigue siendo posible
// fórmula (la expansión solo aplica a celdas numéricas).
for (const v of ['-1e3', '-1E+21', '=1e3', '+1e3', '@SUM(A1)']) {
  test(`sec F-11 XLSX: celda de texto ${JSON.stringify(v)} en valor → posible fórmula`, async () => {
    const r = await importRow([{ n: '46327' }, 'Unidad Alfa', v]);
    assert.equal(r.rows.length, 0);
    assert.match(messages(r), FORMULA, messages(r));
  });
}

// Excel: celda "numérica" cuyo <v> no es un número finito o está manipulado: no se
// expande y se rechaza.
for (const v of ['-1e3x', '-0x10', '-Infinity', '-1E+400', '=1+1', '-1e3;=cmd']) {
  test(`sec F-11 XLSX: <v> numérico manipulado ${JSON.stringify(v)} → rechazado, sin filas`, async () => {
    const r = await importOne(v);
    assert.equal(r.rows.length, 0);
    assert.ok(r.errors.length > 0);
  });
}

// La expansión de un negativo nunca produce un valor aceptado ni texto que no sea número.
for (const v of ['-1E+21', '-9.99E-8', '-1e-30', '-5E-324', '-1.7976931348623157E+308', ' -1E+21 ']) {
  test(`sec F-11 XLSX: negativo ${JSON.stringify(v)} → rechazado "≥ 0", mensaje corto y solo dígitos`, async () => {
    const r = await importOne(v);
    assert.equal(r.rows.length, 0);
    const m = r.errors.find((e) => /valor:/.test(e.message));
    assert.ok(m, messages(r));
    assert.ok(m.message.length < 140, m.message);
    const shown = m.message.match(/valor: "([^"]*)"/);
    if (shown) assert.match(shown[1], /^-[0-9.]+…?$/, shown[1]);
  });
}

test('sec F-11 XLSX: -1E+21 en la columna unidad (celda numérica) no se acepta', async () => {
  const r = await importRow([{ n: '46327' }, { n: '-1E+21' }, { n: '99.95' }]);
  assert.equal(r.rows.length, 0);
  assert.ok(r.errors.length > 0);
});
