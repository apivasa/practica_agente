// F-11 (QA V-07b, info 1) — pruebas del desarrollador. Un negativo en notación
// científica en una celda numérica de Excel se rechaza con el mensaje "≥ 0" y no
// con "posible fórmula". El CSV escrito a mano no cambia.
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

/** Celda: { n: '<texto crudo de <v>>' } numérica; string = texto en línea. */
const cell = (v) => (typeof v === 'object' ? `<c><v>${v.n}</v></c>` : `<c t="inlineStr"><is><t>${v}</t></is></c>`);
const sheetXml = (rows) => `<worksheet xmlns="${NS}"><sheetData>${rows.map((r) => `<row>${r.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`;
const book = (rows) => zip({
  '_rels/.rels': `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  'xl/worksheets/sheet1.xml': sheetXml(rows),
});
const importOne = (raw, ind = avail, extra = []) => {
  const header = ['fecha', 'unidad', 'valor', ...(extra.length ? ['categoria'] : [])];
  return parseMeasurementsXlsx(book([header, [{ n: '46327' }, 'Unidad Alfa', { n: raw }, ...extra]]), ind, ctx, inflateRaw);
};
const messages = (r) => r.errors.map((e) => e.message).join(' | ');

for (const raw of ['-1E+21', '-9.9999999999999995E-8', '-9.99E-8', '-1e-30', '-1.5E+300']) {
  test(`F-11: celda numérica de Excel ${raw} en valor → "debe ser un número ≥ 0", no "posible fórmula"`, async () => {
    const r = await importOne(raw);
    assert.equal(r.rows.length, 0);
    assert.match(messages(r), /valor: .* debe ser un número ≥ 0/);
    assert.doesNotMatch(messages(r), /fórmula\)|posible fórmula/);
  });
}

test('F-11: el valor mostrado de un negativo enorme se recorta (sin cientos de dígitos en el mensaje)', async () => {
  const r = await importOne('-1.5E+300');
  const m = r.errors.find((e) => /valor:/.test(e.message)).message;
  assert.ok(m.length < 120, m);
  assert.match(m, /…/);
});

test('F-11: en un indicador de enteros, -1E+21 de Excel → "debe ser un entero ≥ 0"', async () => {
  const r = await importOne('-1E+21', vuln, ['P0P1']);
  assert.equal(r.rows.length, 0);
  assert.match(messages(r), /debe ser un entero ≥ 0/);
});

test('F-11: positivos con exponente y negativos simples de Excel no cambian', async () => {
  const pos = await importOne('1E+21');
  assert.equal(pos.rows.length, 0);
  assert.doesNotMatch(messages(pos), /posible fórmula/);
  const neg = await importOne('-5');
  assert.match(messages(neg), /≥ 0/);
  const ok = await importOne('99.95');
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.rows[0].value, 99.95);
});

test('F-11: en CSV, el texto -1e3 escrito a mano sigue siendo "posible fórmula" (sin cambio)', () => {
  const r = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,Unidad Alfa,-1e3\n', avail, ctx);
  assert.equal(r.rows.length, 0);
  assert.match(messages(r), /posible fórmula/);
});
