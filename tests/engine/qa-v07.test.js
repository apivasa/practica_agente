// QA V-07 (tester) — importación de mediciones desde Excel .xlsx.
// Criterio (plan-maestro V-07): "un .xlsx de ejemplo importa igual que su CSV;
// archivo con fórmulas, demasiado grande o con columnas erróneas se rechaza con
// mensaje"; mismas columnas, límites y validaciones que el CSV; primera hoja.
// Los fixtures de tests/fixtures/v07 los escriben productores reales
// (XlsxWriter, LibreOffice; ver generate.py), no el lector bajo prueba.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import {
  parseMeasurementsCsv, parseMeasurementsXlsx, buildXlsxTemplate, excelSerialToIsoDate,
  CSV_COLUMNS, CSV_MAX_BYTES, CSV_MAX_ROWS,
} from '../../engine/index.js';
import { inflateRaw } from '../../src/lib/inflate.js';
import { fixture, zip, unzip, workbook, rowsXml, fillTemplate } from '../fixtures/v07/ooxml.js';

const UNITS = [
  { id: 'u-alfa', name: 'Unidad Alfa' }, { id: 'u-beta', name: 'Unidad Beta' }, { id: 'u-gamma', name: 'Unidad Gamma' },
];
const IND = {
  window_average: { measurementType: 'window_average', direction: 'higher_is_better', thresholds: { green: 99.9, yellow: 99.5 } },
  coverage: { measurementType: 'coverage', direction: 'higher_is_better', thresholds: { green: 90, yellow: 75 } },
  cumulative_target: {
    measurementType: 'cumulative_target', direction: 'higher_is_better', thresholds: { green: 85, yellow: 70 },
    thresholdsByCategory: { P0P1: { green: 96, yellow: 90 }, P2P3: { green: 85, yellow: 75 } },
  },
};
const CTX = { units: UNITS, today: '2026-11-20' };
const AVAIL = IND.window_average;

/** inflate con tope (como el front) sobre zlib, para no depender de DecompressionStream. */
const zlibInflate = async (data, max) => {
  const out = inflateRawSync(data, { maxOutputLength: Math.max(1, max) });
  return new Uint8Array(out);
};
const u8 = (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const xlsx = (bytes, ind = AVAIL, ctx = CTX, inflate = inflateRaw) => parseMeasurementsXlsx(u8(bytes), ind, ctx, inflate);
const csv = (name, ind = AVAIL) => parseMeasurementsCsv(fixture(name).toString('utf8'), ind, CTX);
/** Serie de Excel (sistema 1900) de una fecha; ancla conocida 45658 = 2025-01-01. */
const serial = (iso) => 45658 + (Date.parse(`${iso}T00:00:00Z`) - Date.parse('2025-01-01T00:00:00Z')) / 86400000;
const header = (cols) => `<row r="1">${cols.map((c, i) => `<c r="${String.fromCharCode(65 + i)}1" t="inlineStr"><is><t>${c}</t></is></c>`).join('')}</row>`;

describe('V-07 · un .xlsx de ejemplo importa igual que su CSV', () => {
  const cases = [
    ['avail.xlsx (XlsxWriter: sharedStrings, styles.xml, rich text, fechas de serie, segunda hoja)', 'avail.xlsx', 'avail.csv', 'window_average'],
    ['avail-libreoffice.xlsx (LibreOffice Calc a partir del CSV)', 'avail-libreoffice.xlsx', 'avail.csv', 'window_average'],
    ['avail-1904.xlsx (libro con sistema de fechas 1904)', 'avail-1904.xlsx', 'avail.csv', 'window_average'],
    ['avail-hora.xlsx (fechas con hora 23:59:59, 00:00:01 y 12:00)', 'avail-hora.xlsx', 'avail.csv', 'window_average'],
    ['obs.xlsx (coverage con booleanos de Excel)', 'obs.xlsx', 'obs.csv', 'coverage'],
    ['vuln.xlsx (cumulative_target con categoría y tipo, tipo vacío)', 'vuln.xlsx', 'vuln.csv', 'cumulative_target'],
  ];
  for (const [title, x, c, type] of cases) {
    test(title, async () => {
      const fromCsv = csv(c, IND[type]);
      assert.deepEqual(fromCsv.errors, [], 'el CSV de referencia debe ser válido');
      assert.ok(fromCsv.rows.length >= 3);
      const fromXlsx = await xlsx(fixture(x), IND[type]);
      assert.deepEqual(fromXlsx, fromCsv);
    });
  }

  test('el resultado es el mismo con DecompressionStream (front) y con zlib', async () => {
    assert.deepEqual(await xlsx(fixture('avail.xlsx'), AVAIL, CTX, zlibInflate), await xlsx(fixture('avail.xlsx')));
  });

  test('las fechas esperadas del fixture con hora son las del día de calendario, no las del día UTC', async () => {
    const r = await xlsx(fixture('avail-hora.xlsx'));
    assert.deepEqual(r.rows.map((x) => x.date), ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08']);
  });

  // Desfase (getTimezoneOffset, minutos) esperado en enero: comprueba que el hijo usa de verdad esa zona.
  for (const [tz, offset] of [['Pacific/Kiritimati', -840], ['Pacific/Pago_Pago', 660], ['America/Guayaquil', 300], ['Asia/Tokyo', -540]]) {
    test(`fechas de serie (1900, 1904, con hora) no dependen de la zona horaria del proceso: TZ=${tz}`, () => {
      const script = new URL('../fixtures/v07/tz-probe.js', import.meta.url);
      const out = execFileSync(process.execPath, [script.pathname], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
      const res = JSON.parse(out);
      assert.equal(res.offset, offset);
      for (const name of ['avail.xlsx', 'avail-1904.xlsx', 'avail-hora.xlsx', 'avail-libreoffice.xlsx']) {
        assert.deepEqual(res.dates[name], ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'], name);
      }
    });
  }
});

describe('V-07 · fechas de serie de Excel (bordes)', () => {
  test('sistema 1900: 1, 59, 60 (29-feb-1900 inexistente), 61, 2000-01-01 y 9999-12-31', () => {
    assert.equal(excelSerialToIsoDate(1), '1900-01-01');
    assert.equal(excelSerialToIsoDate(59), '1900-02-28');
    assert.equal(excelSerialToIsoDate(60), null);
    assert.equal(excelSerialToIsoDate(61), '1900-03-01');
    assert.equal(excelSerialToIsoDate(36526), '2000-01-01');
    assert.equal(excelSerialToIsoDate(45658), '2025-01-01');
    assert.equal(excelSerialToIsoDate(2958465), '9999-12-31');
    assert.equal(excelSerialToIsoDate(2958466), null);
    assert.equal(excelSerialToIsoDate(0), null);
    assert.equal(excelSerialToIsoDate(-1), null);
  });

  test('sistema 1904: 0 = 1904-01-01 y la misma fecha es 1462 días menor que en 1900', () => {
    assert.equal(excelSerialToIsoDate(0, true), '1904-01-01');
    assert.equal(excelSerialToIsoDate(serial('2026-01-05') - 1462, true), '2026-01-05');
    assert.equal(excelSerialToIsoDate(-1, true), null);
  });

  test('la hora se descarta: 23:59:59.999 sigue siendo el mismo día', () => {
    const s = serial('2026-01-05');
    assert.equal(excelSerialToIsoDate(s + 0.99999), '2026-01-05');
    assert.equal(excelSerialToIsoDate(s + 0.5, false), '2026-01-05');
  });

  test('fecha de serie anterior a 2000 o futura se rechaza como en el CSV', async () => {
    const sheet = header(['fecha', 'unidad', 'valor']) + rowsXml([[36525, 'Unidad Alfa', 99], [serial('2026-11-21'), 'Unidad Alfa', 99]]);
    const r = await xlsx(workbook(sheet));
    assert.deepEqual(r.rows, []);
    assert.deepEqual(r.errors.map((e) => e.row), [2, 3]);
    assert.match(r.errors[0].message, /anterior al año 2000/);
    assert.match(r.errors[1].message, /2026-11-21 es futura/);
  });

  test('fecha de hoy (America/Guayaquil) se acepta', async () => {
    const sheet = header(['fecha', 'unidad', 'valor']) + rowsXml([[serial('2026-11-20'), 'Unidad Alfa', 99]]);
    const r = await xlsx(workbook(sheet));
    assert.deepEqual(r.errors, []);
    assert.equal(r.rows[0].date, '2026-11-20');
  });

  test('celda de fecha ISO (t="d") con hora y zona se queda con el día escrito', async () => {
    const sheet = header(['fecha', 'unidad', 'valor'])
      + rowsXml([[{ xml: '<c r="{ref}" t="d"><v>2026-01-05T23:30:00</v></c>' }, 'Unidad Alfa', 99]]);
    const r = await xlsx(workbook(sheet));
    assert.deepEqual(r.errors, []);
    assert.equal(r.rows[0].date, '2026-01-05');
  });

  test('número en la columna fecha que no es una serie válida se rechaza con mensaje en español', async () => {
    const sheet = header(['fecha', 'unidad', 'valor']) + rowsXml([[60, 'Unidad Alfa', 99]]);
    const r = await xlsx(workbook(sheet));
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].message, /^fecha: .* no es una fecha real/);
  });
});

describe('V-07 · archivo con fórmulas se rechaza con mensaje', () => {
  test('fixture de XlsxWriter con fórmula y valor calculado: rechazado con fila y columna', async () => {
    const r = await xlsx(fixture('avail-formula.xlsx'));
    assert.deepEqual(r, { rows: [], errors: [{ row: 3, message: 'Columna C: la celda tiene una fórmula; no se aceptan fórmulas, copia y pega solo los valores' }] });
  });

  test('fórmula compartida (t="shared"), de matriz y en la cabecera: cada celda se reporta', async () => {
    const sheet = `<row r="1"><c r="A1" t="inlineStr"><is><t>fecha</t></is></c><c r="B1" t="inlineStr"><is><t>unidad</t></is></c><c r="C1" t="str"><f>"valor"</f><v>valor</v></c></row>`
      + rowsXml([
        ['2026-01-05', 'Unidad Alfa', { xml: '<c r="{ref}"><f t="shared" ref="C2:C3" si="0">1+1</f><v>2</v></c>' }],
        ['2026-01-06', 'Unidad Alfa', { xml: '<c r="{ref}"><f t="shared" si="0"/><v>2</v></c>' }],
        ['2026-01-07', 'Unidad Alfa', { xml: '<c r="{ref}"><f t="array" ref="C4">SUM(1)</f><v>1</v></c>' }],
      ]);
    const r = await xlsx(workbook(sheet));
    assert.deepEqual(r.rows, []);
    assert.deepEqual(r.errors.map((e) => e.row), [1, 2, 3, 4]);
    for (const e of r.errors) assert.match(e.message, /^Columna C: la celda tiene una fórmula/);
  });

  test('texto que empieza con = + - @ se rechaza igual que en el CSV (mismo mensaje)', async () => {
    const sheet = header(['fecha', 'unidad', 'valor']) + rowsXml([['2026-01-05', 'Unidad Alfa', '=1+1']]);
    const r = await xlsx(workbook(sheet));
    const c = parseMeasurementsCsv('fecha,unidad,valor\n2026-01-05,Unidad Alfa,=1+1\n', AVAIL, CTX);
    assert.deepEqual(r, c);
    assert.match(r.errors[0].message, /posible fórmula/);
  });

  test('error de Excel sin fórmula (#DIV/0!) se rechaza', async () => {
    const sheet = header(['fecha', 'unidad', 'valor']) + rowsXml([['2026-01-05', 'Unidad Alfa', { xml: '<c r="{ref}" t="e"><v>#DIV/0!</v></c>' }]]);
    const r = await xlsx(workbook(sheet));
    assert.deepEqual(r.errors, [{ row: 2, message: 'Columna C: la celda tiene un error de Excel (#DIV/0!)' }]);
  });
});

describe('V-07 · archivo demasiado grande se rechaza con mensaje', () => {
  /** .xlsx válido de exactamente `size` bytes (relleno en una parte sin comprimir que no se lee). */
  function xlsxOfSize(size) {
    const sheet = header(['fecha', 'unidad', 'valor']) + rowsXml([['2026-01-05', 'Unidad Alfa', 99.9]]);
    // Sin compresión: cada byte de relleno suma un byte al archivo.
    const base = workbook(sheet, { store: true, extraFiles: { 'docProps/relleno.bin': Buffer.alloc(0) } }).length;
    assert.ok(size > base);
    return workbook(sheet, { store: true, extraFiles: { 'docProps/relleno.bin': Buffer.alloc(size - base, 0x41) } });
  }

  test(`exactamente ${CSV_MAX_BYTES} bytes (1 MiB) se acepta, igual que el CSV`, async () => {
    const b = xlsxOfSize(CSV_MAX_BYTES);
    assert.equal(b.length, CSV_MAX_BYTES);
    const r = await xlsx(b);
    assert.deepEqual(r.errors, []);
    assert.equal(r.rows.length, 1);
  });

  test(`${CSV_MAX_BYTES + 1} bytes se rechaza con "El archivo supera 1 MB" (mismo mensaje que el CSV)`, async () => {
    const b = xlsxOfSize(CSV_MAX_BYTES + 1);
    assert.equal(b.length, CSV_MAX_BYTES + 1);
    const r = await xlsx(b);
    assert.deepEqual(r, { rows: [], errors: [{ row: null, message: 'El archivo supera 1 MB' }] });
    assert.deepEqual(parseMeasurementsCsv('a'.repeat(CSV_MAX_BYTES + 1), AVAIL, CTX), r);
  });

  test(`${CSV_MAX_ROWS} filas se aceptan y ${CSV_MAX_ROWS + 1} se rechazan como en el CSV`, async () => {
    const make = (n) => header(['fecha', 'unidad', 'valor'])
      + rowsXml(Array.from({ length: n }, () => [serial('2026-01-05'), 'Unidad Alfa', 99]));
    const ok = await xlsx(workbook(make(CSV_MAX_ROWS)));
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.rows.length, CSV_MAX_ROWS);
    const ko = await xlsx(workbook(make(CSV_MAX_ROWS + 1)));
    assert.deepEqual(ko, { rows: [], errors: [{ row: null, message: `El archivo tiene ${CSV_MAX_ROWS + 1} filas; el máximo es ${CSV_MAX_ROWS}` }] });
  });

  test('archivo pequeño que se descomprime en más de 8 MiB (zip bomb) se rechaza con mensaje', async () => {
    const big = `<row r="2"><c r="A2" t="inlineStr"><is><t>${' '.repeat(9 * 1024 * 1024)}</t></is></c></row>`;
    const b = workbook(header(['fecha', 'unidad', 'valor']) + big);
    assert.ok(b.length < CSV_MAX_BYTES);
    const r = await xlsx(b);
    assert.deepEqual(r, { rows: [], errors: [{ row: null, message: 'El archivo Excel es demasiado grande al descomprimirlo' }] });
  });
});

describe('V-07 · columnas erróneas: mismos mensajes que el CSV', () => {
  test('fixture con columna mal escrita y columna extra', async () => {
    const r = await xlsx(fixture('avail-columnas.xlsx'));
    assert.deepEqual(r, csv('avail-columnas.csv'));
    assert.deepEqual(r.errors.map((e) => e.message), [
      'Cabecera: faltan columnas valor (esperadas: fecha, unidad, valor)',
      'Cabecera: columnas no reconocidas valr, comentario',
    ]);
  });

  test('columnas repetidas y columnas de otro tipo de indicador', async () => {
    const dup = await xlsx(workbook(header(['fecha', 'unidad', 'valor', 'Valor']) + rowsXml([['2026-01-05', 'Unidad Alfa', 1, 2]])));
    assert.deepEqual(dup, parseMeasurementsCsv('fecha,unidad,valor,Valor\n2026-01-05,Unidad Alfa,1,2\n', AVAIL, CTX));
    assert.match(dup.errors[0].message, /columnas repetidas valor/);
    const other = await xlsx(workbook(header(['fecha', 'unidad', 'app_id', 'cumple']) + rowsXml([['2026-01-05', 'Unidad Alfa', 'a', 'sí']])));
    assert.deepEqual(other, parseMeasurementsCsv('fecha,unidad,app_id,cumple\n2026-01-05,Unidad Alfa,a,sí\n', AVAIL, CTX));
  });

  test('dato fuera de la cabecera se rechaza en su fila', async () => {
    const r = await xlsx(workbook(header(['fecha', 'unidad', 'valor']) + rowsXml([['2026-01-05', 'Unidad Alfa', 99, 'extra']])));
    assert.deepEqual(r.rows, []);
    assert.equal(r.errors[0].row, 2);
  });

  test('errores de valor fila a fila: mismos mensajes que el CSV', async () => {
    const rows = [['2026-02-30', 'Unidad Alfa', 99.9], ['2026-01-10', 'Unidad Inexistente', 99.9], ['2026-01-10', 'Unidad Alfa', -5], ['2026-01-11', 'Unidad Alfa', 'abc']];
    const r = await xlsx(workbook(header(['fecha', 'unidad', 'valor']) + rowsXml(rows)));
    const c = parseMeasurementsCsv(`fecha,unidad,valor\n${rows.map((x) => x.join(',')).join('\n')}\n`, AVAIL, CTX);
    assert.deepEqual(r, c);
    assert.equal(r.errors.length, 4);
  });
});

describe('V-07 · estructuras reales de Excel', () => {
  test('sharedStrings con rich text, fonética (rPh) y xml:space; celdas con estilo vacías se ignoran', async () => {
    const ss = [
      '<si><t>fecha</t></si>', '<si><t xml:space="preserve"> unidad </t></si>', '<si><t>valor</t></si>',
      '<si><r><rPr><b/><sz val="11"/></rPr><t xml:space="preserve">Unidad </t></r><r><rPr><i/></rPr><t>Alfa</t></r><rPh sb="0" eb="1"><t>ユ</t></rPh><phoneticPr fontId="1"/></si>',
    ];
    const sheet = '<row r="1" spans="1:3" x14ac:dyDescent="0.25"><c r="A1" t="s"><v>0</v></c><c r="B1" s="0" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" s="1"/></row>'
      + `<row r="2" spans="1:3"><c r="A2" s="1"><v>${serial('2026-01-05')}</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>99.950000000000003</v></c><c r="D2" s="1"/></row>`
      + '<row r="3" s="1" customFormat="1"><c r="A3" s="1"/></row>';
    const r = await xlsx(workbook(sheet, { sharedStrings: ss }));
    assert.deepEqual(r, parseMeasurementsCsv('fecha,unidad,valor\n2026-01-05,Unidad Alfa,99.95\n', AVAIL, CTX));
  });

  test('comentarios XML y CDATA en el texto se leen como texto (y una fórmula en CDATA se sigue rechazando)', async () => {
    const ss = ['<si><t>fecha</t></si>', '<!-- generado --><si><t><![CDATA[unidad]]></t></si>', '<si><t>valor</t></si>',
      '<si><t><![CDATA[Unidad <Alfa>]]></t></si>', '<si><t><![CDATA[=1+1]]></t></si>'];
    const sheet = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>2026-01-05</t></is></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row>';
    const r = await xlsx(workbook(sheet, { sharedStrings: ss }));
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].message, /unidad: "Unidad <Alfa>" no existe/);
    assert.match(r.errors[0].message, /valor: la celda empieza con =/);
  });

  test('ZIP con descriptores de datos (bit 3, como los escritores en streaming)', async () => {
    const sheet = header(['fecha', 'unidad', 'valor']) + rowsXml([[serial('2026-01-05'), 'Unidad Alfa', 99.95]]);
    const r = await xlsx(workbook(sheet, { descriptor: true }));
    assert.deepEqual(r.errors, []);
    assert.equal(r.rows[0].date, '2026-01-05');
  });

  test('OOXML estricto (espacios de nombres purl.oclc.org) se lee igual', async () => {
    const sheet = header(['fecha', 'unidad', 'valor']) + rowsXml([[serial('2026-01-05'), 'Unidad Alfa', 99.95]]);
    const r = await xlsx(workbook(sheet, { strict: true }));
    assert.deepEqual(r.errors, []);
    assert.equal(r.rows[0].value, 99.95);
  });

  test('filas en blanco intermedias se ignoran y los errores citan la fila de Excel', async () => {
    const sheet = header(['fecha', 'unidad', 'valor'])
      + '<row r="4"><c r="A4" t="inlineStr"><is><t>2026-02-30</t></is></c><c r="B4" t="inlineStr"><is><t>Unidad Alfa</t></is></c><c r="C4"><v>1</v></c></row>';
    const r = await xlsx(workbook(sheet));
    assert.equal(r.errors[0].row, 4);
  });

  test('un .xls antiguo (OLE) o un CSV renombrado a .xlsx se rechazan con mensaje en español', async () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    const a = await xlsx(ole);
    assert.match(a.errors[0].message, /Excel antiguo \(\.xls\)/);
    const b = await xlsx(fixture('avail.csv'));
    assert.match(b.errors[0].message, /no es un libro de Excel \.xlsx válido/);
  });
});

describe('V-07 · plantilla descargable', () => {
  for (const type of Object.keys(CSV_COLUMNS)) {
    test(`plantilla de ${type}: cabecera con las columnas del CSV, ZIP legible y reimportable`, async () => {
      const cols = [...CSV_COLUMNS[type].required, ...CSV_COLUMNS[type].optional];
      const t = buildXlsxTemplate(cols);
      const files = unzip(t);
      for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']) assert.ok(files[p], p);
      // Sin filas: el único error es la falta de datos, no la cabecera.
      const bare = await xlsx(t, IND[type]);
      assert.deepEqual(bare, { rows: [], errors: [{ row: null, message: 'El archivo no tiene filas de datos' }] });
      const sample = {
        window_average: [[serial('2026-01-05'), 'Unidad Alfa', 99.9], ['2026-01-06', 'Unidad Beta', 99.5]],
        coverage: [[serial('2026-01-05'), 'Unidad Alfa', 'app-1', true], ['2026-01-06', 'Unidad Beta', 'app-2', 'no']],
        cumulative_target: [[serial('2026-01-05'), 'Unidad Alfa', 3, 'P0P1', 'resuelta'], ['2026-01-06', 'Unidad Beta', 4, 'P2P3', 'detectada']],
      }[type];
      const filled = await xlsx(fillTemplate(t, sample), IND[type]);
      assert.deepEqual(filled.errors, []);
      assert.deepEqual(filled.rows.map((r) => r.date), ['2026-01-05', '2026-01-06']);
    });
  }

  test('nombres de columna con caracteres XML se escapan en la plantilla', () => {
    const files = unzip(buildXlsxTemplate(['a<b', 'c&d']));
    const sheet = files['xl/worksheets/sheet1.xml'].toString('utf8');
    assert.ok(sheet.includes('a&lt;b') && sheet.includes('c&amp;d'));
  });

  test('el ZIP propio del lector y node:zlib coinciden sobre la plantilla (comprimida de nuevo)', async () => {
    const t = buildXlsxTemplate(['fecha', 'unidad', 'valor']);
    const recompressed = zip(unzip(t));
    assert.deepEqual(await xlsx(recompressed), await xlsx(t));
  });
});
