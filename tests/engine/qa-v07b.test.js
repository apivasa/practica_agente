// QA V-07b (tester) — bajos de V-07. Cada caso traza a una frase del ítem
// (plan-maestro, fila V-07b) o a los hallazgos de docs/reportes/V-07-*.md:
//  H-V07-01 "inflar con tope min(maxBytes, entry.size)"
//  QA-V07-1 "mensaje «debe ser un número ≥ 0» para negativos numéricos (no «posible fórmula»)"
//  QA-V07-2 "redondear la serie de Excel al milisegundo antes de truncar"
//  H-V07-02 "cortar la hoja al superar 5001 filas"
// Además se exige no romper V-07: "mismas columnas, límites y validaciones que el CSV".
// Los .xlsx se arman con el generador de fixtures de V-07 (estructura de Excel), no con el del desarrollador.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  parseMeasurementsCsv, parseMeasurementsXlsx, excelSerialToIsoDate, listZipEntries, readZipEntry,
  CSV_MAX_ROWS, XLSX_MAX_PART_BYTES,
} from '../../engine/index.js';
import { inflateRaw } from '../../src/lib/inflate.js';
import { fixture, zip, unzip, workbook, rowsXml } from '../fixtures/v07/ooxml.js';

const UNITS = [{ id: 'u-alfa', name: 'Unidad Alfa' }, { id: 'u-beta', name: 'Unidad Beta' }];
const CTX = { units: UNITS, today: '2027-02-15' };
const AVAIL = { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } };
const VULN = {
  measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 },
  thresholdsByCategory: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
};
const u8 = (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const xlsx = (bytes, ind = AVAIL, inflate = inflateRaw, ctx = CTX) => parseMeasurementsXlsx(u8(bytes), ind, ctx, inflate);
const header = (cols) => rowsXml([cols], 1);
const sheet = (cols, rows) => workbook(header(cols) + rowsXml(rows));
const SHEET = 'xl/worksheets/sheet1.xml';
const DAY = 86400000;
/** Serie 1900 de una fecha ISO (45658 = 2025-01-01). */
const serial = (iso) => 45658 + (Date.parse(`${iso}T00:00:00Z`) - Date.parse('2025-01-01T00:00:00Z')) / DAY;

/** Cambia el tamaño descomprimido declarado de una entrada (cabecera local y directorio central). */
function declareSize(zipBytes, name, size) {
  const buf = Buffer.from(zipBytes);
  const nb = Buffer.from(name);
  for (let p = 0; p + 4 <= buf.length; p++) {
    const sig = buf.readUInt32LE(p);
    if (sig === 0x04034b50 && buf.subarray(p + 30, p + 30 + nb.length).equals(nb)) buf.writeUInt32LE(size, p + 22);
    if (sig === 0x02014b50 && buf.subarray(p + 46, p + 46 + nb.length).equals(nb)) buf.writeUInt32LE(size, p + 24);
  }
  return buf;
}

/** Envuelve un descompresor y anota el tope que recibe y cuánto entrega. */
function spy(inner = inflateRaw) {
  const calls = [];
  const fn = async (data, max) => {
    const call = { max, out: null };
    calls.push(call);
    const out = await inner(data, max);
    call.out = out.length;
    return out;
  };
  return { fn, calls };
}

// --------------------------------------------------------------- H-V07-01
describe('H-V07-01 · el descompresor recibe como tope min(maxBytes, tamaño declarado)', () => {
  test('en un .xlsx real (XlsxWriter) cada parte deflate se infla con tope = su tamaño declarado y el resultado no cambia', async () => {
    const bytes = fixture('avail.xlsx');
    const entries = listZipEntries(u8(bytes));
    const s = spy();
    const r = await xlsx(bytes, AVAIL, s.fn, { units: [{ id: 'u-alfa', name: 'Unidad Alfa' }, { id: 'u-beta', name: 'Unidad Beta' }, { id: 'u-gamma', name: 'Unidad Gamma' }], today: '2026-11-20' });
    assert.ok(s.calls.length >= 3, 'se infló más de una parte');
    const declared = new Set([...entries.values()].filter((e) => e.method === 8).map((e) => e.size));
    for (const c of s.calls) {
      assert.ok(declared.has(c.max), `tope ${c.max} = tamaño declarado de alguna parte`);
      assert.ok(c.max < XLSX_MAX_PART_BYTES);
      assert.equal(c.out, c.max, 'parte honesta: sale exactamente lo declarado (en el tope no se corta)');
    }
    assert.deepEqual(r.errors, []);
    assert.ok(r.rows.length >= 3);
  });

  test('bomba: la hoja declara 4 KB y se expande a 64 MiB → rechazo como archivo dañado y el descompresor real entrega poco más de 4 KB', async () => {
    const good = workbook(header(['fecha', 'unidad', 'valor']));
    // Reemplaza la hoja por 64 MiB de ceros comprimidos y declara 4 KB.
    const files = {};
    for (const [k, v] of Object.entries(unzip(good))) files[k] = v;
    files[SHEET] = Buffer.alloc(64 * 1024 * 1024);
    const bomb = declareSize(zip(files), SHEET, 4096);
    const s = spy();
    const t0 = Date.now();
    const r = await xlsx(bomb, AVAIL, s.fn);
    const ms = Date.now() - t0;
    assert.equal(r.rows.length, 0);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].row, null);
    assert.match(r.errors[0].message, /dañado/);
    assert.match(r.errors[0].message, /tamaño declarado/);
    const sheetCall = s.calls.find((c) => c.max === 4096);
    assert.ok(sheetCall, 'la hoja se infló con tope 4096');
    assert.equal(sheetCall.out, null, 'el descompresor cortó (lanzó) en vez de entregar');
    assert.ok(ms < 5000, `corta rápido (${ms} ms)`);
  });

  test('una parte que se infla 1 byte por encima de lo declarado se rechaza como dañada (no como "demasiado grande")', async () => {
    const xml = '<?xml version="1.0"?><x>' + 'a'.repeat(2000) + '</x>';
    const data = Buffer.from(xml);
    const comp = deflateRawSync(data);
    const entry = { method: 8, crc: 0, compressedSize: comp.length, size: data.length - 1, dataStart: 0 };
    await assert.rejects(readZipEntry(u8(comp), entry, inflateRaw, XLSX_MAX_PART_BYTES), (e) => e.code === 'invalid' && /dañado/.test(e.message));
  });

  test('tamaño declarado 0 con datos deflate que producen bytes → se rechaza sin aceptar la salida', async () => {
    const comp = deflateRawSync(Buffer.from('hola'));
    const entry = { method: 8, crc: 0, compressedSize: comp.length, size: 0, dataStart: 0 };
    const s = spy();
    await assert.rejects(readZipEntry(u8(comp), entry, s.fn, XLSX_MAX_PART_BYTES), (e) => e.name === 'ZipError' && /dañado/.test(e.message));
    assert.equal(s.calls[0].max, 0);
  });

  test('tamaño declarado mayor que el tope: se rechaza como "demasiado grande" sin llamar al descompresor', async () => {
    const comp = deflateRawSync(Buffer.from('x'));
    const entry = { method: 8, crc: 0, compressedSize: comp.length, size: XLSX_MAX_PART_BYTES + 1, dataStart: 0 };
    const s = spy();
    await assert.rejects(readZipEntry(u8(comp), entry, s.fn, XLSX_MAX_PART_BYTES), (e) => e.code === 'limit' && /demasiado grande/.test(e.message));
    assert.equal(s.calls.length, 0);
  });

  test('el mismo tope funciona con zlib (maxOutputLength), no solo con DecompressionStream', async () => {
    const zlibInflate = async (data, max) => {
      try { return new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(1, max) })); } catch (err) {
        if (err.code === 'ERR_BUFFER_TOO_LARGE') throw Object.assign(new Error('limit'), { code: 'limit' });
        throw err;
      }
    };
    const files = unzip(workbook(header(['fecha', 'unidad', 'valor'])));
    files[SHEET] = Buffer.alloc(8 * 1024 * 1024);
    const r = await xlsx(declareSize(zip(files), SHEET, 1024), AVAIL, zlibInflate);
    assert.match(r.errors[0].message, /dañado/);
  });
});

// --------------------------------------------------------------- QA-V07-1
describe('QA-V07-1 · un negativo numérico dice "debe ser un número ≥ 0", no "posible fórmula"', () => {
  const noFormulaWarning = (m) => assert.doesNotMatch(m, /posible fórmula|empieza con =/);

  test('Excel: celda numérica -5 en valor → mensaje ≥ 0, fila 2', async () => {
    const r = await xlsx(sheet(['fecha', 'unidad', 'valor'], [['2027-01-10', 'Unidad Alfa', -5]]));
    assert.deepEqual(r.rows, []);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].row, 2);
    assert.match(r.errors[0].message, /^valor: "-5" debe ser un número ≥ 0/);
    noFormulaWarning(r.errors[0].message);
  });

  test('Excel: decimal negativo -0.5 y CSV "-0,5" dan el mismo mensaje (mismas validaciones)', async () => {
    const x = await xlsx(sheet(['fecha', 'unidad', 'valor'], [['2027-01-10', 'Unidad Alfa', -0.5]]));
    const c = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,Unidad Alfa,-0.5\n', AVAIL, CTX);
    assert.deepEqual(x, c);
    assert.match(x.errors[0].message, /≥ 0/);
    noFormulaWarning(x.errors[0].message);
    const comma = parseMeasurementsCsv('fecha;unidad;valor\n2027-01-10;Unidad Alfa;-0,5\n', AVAIL, CTX);
    assert.match(comma.errors[0].message, /≥ 0/);
  });

  test('cumulative_target: -3 dice "debe ser un entero ≥ 0"', async () => {
    const r = await xlsx(sheet(['fecha', 'unidad', 'valor', 'categoria'], [['2027-01-10', 'Unidad Alfa', -3, 'P0P1']]), VULN);
    assert.match(r.errors[0].message, /un entero ≥ 0/);
    noFormulaWarning(r.errors[0].message);
  });

  test('el negativo se sigue rechazando: la fila no entra y no se acepta el archivo', async () => {
    const r = await xlsx(sheet(['fecha', 'unidad', 'valor'], [['2027-01-10', 'Unidad Alfa', 99.9], ['2027-01-11', 'Unidad Alfa', -1]]));
    assert.deepEqual(r.rows, []);
    assert.deepEqual(r.errors.map((e) => e.row), [3]);
  });

  test('lo que no es un negativo simple sigue avisando "posible fórmula": -1+2 en valor, -5 en unidad, -A1', () => {
    const r = parseMeasurementsCsv('fecha,unidad,valor\n2027-01-10,Unidad Alfa,-1+2\n2027-01-10,-5,99\n2027-01-10,Unidad Alfa,-A1\n', AVAIL, CTX);
    assert.equal(r.errors.length, 3);
    for (const e of r.errors) assert.match(e.message, /posible fórmula/);
  });

  test('0 sigue siendo válido (el borde del "≥ 0")', async () => {
    const r = await xlsx(sheet(['fecha', 'unidad', 'valor'], [['2027-01-10', 'Unidad Alfa', 0]]));
    assert.deepEqual(r.errors, []);
    assert.equal(r.rows[0].value, 0);
  });
});

// --------------------------------------------------------------- QA-V07-2
describe('QA-V07-2 · la serie de Excel se redondea al milisegundo antes de truncar', () => {
  const d = serial('2026-01-06');

  test('caso del informe: 46028 - 1e-9 es 2026-01-06 (antes daba 2026-01-05)', () => {
    assert.equal(d, 46028);
    assert.equal(excelSerialToIsoDate(46028 - 1e-9), '2026-01-06');
  });

  test('bordes del redondeo al ms: 0,4 ms antes de medianoche → día siguiente; 0,6 ms antes → mismo día (23:59:59.999)', () => {
    assert.equal(excelSerialToIsoDate(d - 0.4 / DAY), '2026-01-06');
    assert.equal(excelSerialToIsoDate(d - 0.6 / DAY), '2026-01-05');
    assert.equal(excelSerialToIsoDate(d - 1 / DAY), '2026-01-05');
    assert.equal(excelSerialToIsoDate(d + 1e-9), '2026-01-06');
  });

  test('sistema 1904: el mismo redondeo', () => {
    const d1904 = d - 1462;
    assert.equal(excelSerialToIsoDate(d1904 - 1e-9, true), '2026-01-06');
    assert.equal(excelSerialToIsoDate(d1904 - 0.6 / DAY, true), '2026-01-05');
  });

  test('bordes de rango con el redondeo: 60 (29-feb-1900 inexistente) sigue nulo; 61-1e-9 es 1900-03-01; 9999-12-31 y su desborde', () => {
    assert.equal(excelSerialToIsoDate(60 - 1e-9), null);
    assert.equal(excelSerialToIsoDate(61 - 1e-9), '1900-03-01');
    assert.equal(excelSerialToIsoDate(1 - 1e-9), '1900-01-01');
    assert.equal(excelSerialToIsoDate(2958465.5), '9999-12-31');
    assert.equal(excelSerialToIsoDate(2958466 - 1e-9), null);
    assert.equal(excelSerialToIsoDate(1e300), null);
    assert.equal(excelSerialToIsoDate(-1e300), null);
    assert.equal(excelSerialToIsoDate(Number.MAX_VALUE), null);
  });

  test('de punta a punta: una celda de fecha 46027.9999999999 se importa como 2026-01-06', async () => {
    const r = await xlsx(sheet(['fecha', 'unidad', 'valor'], [[46027.9999999999, 'Unidad Alfa', 99.9]]));
    assert.deepEqual(r.errors, []);
    assert.equal(r.rows[0].date, '2026-01-06');
  });
});

// --------------------------------------------------------------- H-V07-02
describe(`H-V07-02 · la hoja se corta al superar ${CSV_MAX_ROWS + 1} filas de datos`, () => {
  const COLS = ['fecha', 'unidad', 'valor'];
  const dataRows = (n) => Array.from({ length: n }, (_, i) => [serial('2026-01-01') + (i % 300), i % 2 ? 'Unidad Alfa' : 'Unidad Beta', 99.9]);
  const csvOf = (n) => ['fecha,unidad,valor', ...dataRows(n).map((r) => `${excelSerialToIsoDate(r[0])},${r[1]},${r[2]}`)].join('\n');

  test(`exactamente ${CSV_MAX_ROWS} filas de datos: se importan todas, igual que el CSV`, async () => {
    const x = await xlsx(sheet(COLS, dataRows(CSV_MAX_ROWS)));
    assert.deepEqual(x.errors, []);
    assert.equal(x.rows.length, CSV_MAX_ROWS);
    assert.deepEqual(x, parseMeasurementsCsv(csvOf(CSV_MAX_ROWS), AVAIL, CTX));
  });

  test(`${CSV_MAX_ROWS + 1} filas: mismo resultado (y mensaje) que el CSV`, async () => {
    const x = await xlsx(sheet(COLS, dataRows(CSV_MAX_ROWS + 1)));
    const c = parseMeasurementsCsv(csvOf(CSV_MAX_ROWS + 1), AVAIL, CTX);
    assert.deepEqual(x, c);
    assert.match(x.errors[0].message, new RegExp(`${CSV_MAX_ROWS + 1} filas; el máximo es ${CSV_MAX_ROWS}`));
  });

  test(`${CSV_MAX_ROWS + 2} filas: error de archivo que dice el máximo, sin filas`, async () => {
    const x = await xlsx(sheet(COLS, dataRows(CSV_MAX_ROWS + 2)));
    assert.deepEqual(x.rows, []);
    assert.equal(x.errors.length, 1);
    assert.equal(x.errors[0].row, null);
    assert.match(x.errors[0].message, new RegExp(`el máximo es ${CSV_MAX_ROWS}`));
  });

  test('el corte es durante el análisis: XML roto después de la fila 5003 no se llega a leer', async () => {
    const files = unzip(sheet(COLS, dataRows(CSV_MAX_ROWS + 10)));
    files[SHEET] = files[SHEET].toString('utf8').replace('</sheetData>', '<row r="99999"><c><v>1</v></c></row><roto></sheetData>');
    const x = await xlsx(zip(files));
    assert.match(x.errors[0].message, /el máximo es 5000/);
    assert.doesNotMatch(x.errors[0].message, /XML|mal formado/);
  });

  test('una hoja grande (130 000 filas, cerca del tope de elementos XML del caso H-V07-02) cabe en 1 MB y se rechaza por filas, no por complejidad XML', async () => {
    const big = '<row><c><v>1</v></c><c><v>2</v></c></row>'.repeat(130000);
    const bytes = workbook(header(COLS) + big);
    assert.ok(bytes.length < 1024 * 1024, `el .xlsx pesa ${bytes.length} B`);
    const x = await xlsx(bytes);
    assert.match(x.errors[0].message, /filas; el máximo es 5000/);
  });

  test('filas vacías intercaladas no cuentan: 5000 filas con datos y 5000 vacías se importan', async () => {
    const rows = dataRows(CSV_MAX_ROWS);
    let n = 2;
    let xml = header(COLS);
    for (const r of rows) {
      xml += `<row r="${n++}"/>`; // vacía
      xml += rowsXml([r], n++);
    }
    const x = await xlsx(workbook(xml));
    assert.deepEqual(x.errors, []);
    assert.equal(x.rows.length, CSV_MAX_ROWS);
  });

  test('con el corte se siguen validando fórmulas y orden de filas en las filas leídas', async () => {
    const f = await xlsx(workbook(header(COLS) + '<row r="2"><c r="A2"><f>TODAY()</f><v>46000</v></c><c r="B2" t="inlineStr"><is><t>Unidad Alfa</t></is></c><c r="C2"><v>1</v></c></row>'));
    assert.match(f.errors[0].message, /fórmula/);
    const o = await xlsx(workbook(header(COLS) + '<row r="3"><c r="C3"><v>1</v></c></row><row r="2"><c r="C2"><v>1</v></c></row>'));
    assert.match(o.errors[0].message, /fuera de orden/);
  });
});
