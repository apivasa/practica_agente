import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture, workbook, rowsXml, fillTemplate } from '../tests/fixtures/v07/ooxml.js';

// QA V-07 (tester): importación de mediciones desde Excel .xlsx en la pantalla del
// custodio. Criterio: "un .xlsx de ejemplo importa igual que su CSV; archivo con
// fórmulas, demasiado grande o con columnas erróneas se rechaza con mensaje".
// Los fixtures (tests/fixtures/v07) los generan XlsxWriter y LibreOffice, con
// sharedStrings, styles.xml y rich text, no el lector bajo prueba.
// custodio2 custodia AVAIL (window_average) y OBS (coverage) en la semilla.
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Local-Only-Pass-2026';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIB = 1024 * 1024;
const EXPECTED_AVAIL = [
  ['2', '2026-01-05', 'Unidad Alfa', '99.95'],
  ['3', '2026-01-06', 'Unidad Beta', '99.5'],
  ['4', '2026-01-07', 'Unidad Alfa', '100'],
  ['5', '2026-01-08', 'Unidad Beta', '98.7'],
];

async function login(page, email) {
  await page.goto('./#/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/(login)?$/);
}

async function openMeasurements(page, label) {
  await login(page, 'custodio2@example.test');
  await page.goto('./#/custodio/mediciones');
  await page.getByLabel('Indicador', { exact: true }).selectOption({ label });
  await expect(fileInput(page)).toBeAttached();
}

const fileInput = (page) => page.getByLabel('Archivo CSV o Excel (.xlsx)');
const errorsBox = (page) => page.locator('.csv-errors');
const saveButton = (page) => page.getByRole('button', { name: /Guardar .*mediciones/ });

const xlsxFile = (name, buffer) => ({ name, mimeType: XLSX_MIME, buffer: Buffer.from(buffer) });
const csvFile = (name, buffer) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(buffer) });

/** Sube un archivo partiendo de un formulario limpio (vacía el input antes). */
async function upload(page, file) {
  await fileInput(page).setInputFiles([]);
  await expect(page.locator('.csv-preview')).toBeEmpty();
  await fileInput(page).setInputFiles(file);
}

/** Lo que el custodio ve tras elegir el archivo: resumen y celdas de la vista previa. */
async function previewOf(page) {
  const ok = page.locator('.csv-ok');
  await expect(ok.or(errorsBox(page))).toBeVisible();
  if (await errorsBox(page).isVisible()) return { errors: await errorsBox(page).locator('li').allInnerTexts() };
  const table = page.getByRole('table', { name: /Vista previa/ });
  const rows = [];
  for (const tr of await table.locator('tbody tr').all()) rows.push(await tr.locator('td').allInnerTexts());
  return { ok: await ok.innerText(), save: await saveButton(page).innerText(), rows };
}

const serial = (iso) => 45658 + (Date.parse(`${iso}T00:00:00Z`) - Date.parse('2025-01-01T00:00:00Z')) / 86400000;
const header = (cols) => `<row r="1">${cols.map((c, i) => `<c r="${String.fromCharCode(65 + i)}1" t="inlineStr"><is><t>${c}</t></is></c>`).join('')}</row>`;

test.describe('V-07 · un .xlsx de ejemplo importa igual que su CSV', () => {
  test('el control acepta CSV y .xlsx y ofrece la plantilla', async ({ page }) => {
    await openMeasurements(page, 'AVAIL · Disponibilidad');
    await expect(fileInput(page)).toHaveAttribute('accept', /\.xlsx/);
    await expect(fileInput(page)).toHaveAttribute('accept', /\.csv/);
    await expect(page.getByRole('button', { name: 'Descargar plantilla Excel (.xlsx)' })).toBeVisible();
  });

  test('AVAIL: misma vista previa con el CSV, el .xlsx de XlsxWriter (rich text, segunda hoja) y el de LibreOffice', async ({ page }) => {
    await openMeasurements(page, 'AVAIL · Disponibilidad');
    await upload(page, csvFile('avail.csv', fixture('avail.csv')));
    const fromCsv = await previewOf(page);
    expect(fromCsv).toEqual({ ok: '4 filas válidas, listas para guardar.', save: 'Guardar 4 mediciones', rows: EXPECTED_AVAIL });
    for (const name of ['avail.xlsx', 'avail-libreoffice.xlsx', 'avail-1904.xlsx', 'avail-hora.xlsx']) {
      await upload(page, xlsxFile(name, fixture(name)));
      expect(await previewOf(page), name).toEqual(fromCsv);
      await expect(saveButton(page)).toBeEnabled();
    }
  });

  test('OBS: booleanos de Excel (VERDADERO/FALSO) dan la misma vista previa que sí/no del CSV', async ({ page }) => {
    await openMeasurements(page, 'OBS · Observabilidad');
    await upload(page, csvFile('obs.csv', fixture('obs.csv')));
    const fromCsv = await previewOf(page);
    expect(fromCsv.rows).toEqual([
      ['2', '2026-01-12', 'Unidad Alfa', 'app-01: cumple'],
      ['3', '2026-01-12', 'Unidad Beta', 'app-02: no cumple'],
      ['4', '2026-01-13', 'Unidad Alfa', 'app-03: cumple'],
    ]);
    await upload(page, xlsxFile('obs.xlsx', fixture('obs.xlsx')));
    expect(await previewOf(page)).toEqual(fromCsv);
  });
});

// La fecha de serie es una fecha de calendario: no debe moverse con la zona del navegador.
for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
  test.describe(`V-07 · fechas de Excel con el navegador en ${timezoneId}`, () => {
    test.use({ timezoneId });

    test('libro 1900, libro 1904 y fecha con hora dan las mismas fechas que el CSV', async ({ page }) => {
      await openMeasurements(page, 'AVAIL · Disponibilidad');
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(timezoneId);
      for (const name of ['avail.xlsx', 'avail-1904.xlsx', 'avail-hora.xlsx', 'avail-libreoffice.xlsx']) {
        await upload(page, xlsxFile(name, fixture(name)));
        expect((await previewOf(page)).rows, name).toEqual(EXPECTED_AVAIL);
      }
    });
  });
}

test.describe('V-07 · rechazos con mensaje en español', () => {
  test('archivo con fórmula: se rechaza con fila y columna y no se puede guardar', async ({ page }) => {
    await openMeasurements(page, 'AVAIL · Disponibilidad');
    await upload(page, xlsxFile('avail-formula.xlsx', fixture('avail-formula.xlsx')));
    await expect(errorsBox(page)).toContainText('El archivo tiene 1 error; no se guardó nada.');
    await expect(errorsBox(page).locator('li')).toHaveText([
      'Fila 3: Columna C: la celda tiene una fórmula; no se aceptan fórmulas, copia y pega solo los valores',
    ]);
    await expect(saveButton(page)).toBeDisabled();
  });

  test('archivo de más de 1 MiB se rechaza; exactamente 1 MiB se acepta', async ({ page }) => {
    await openMeasurements(page, 'AVAIL · Disponibilidad');
    const sheet = header(['fecha', 'unidad', 'valor']) + rowsXml([[serial('2026-01-05'), 'Unidad Alfa', 99.9]]);
    const base = workbook(sheet, { store: true, extraFiles: { 'docProps/relleno.bin': Buffer.alloc(0) } }).length;
    const ofSize = (size) => workbook(sheet, { store: true, extraFiles: { 'docProps/relleno.bin': Buffer.alloc(size - base, 0x41) } });

    const big = ofSize(MIB + 1);
    expect(big.length).toBe(MIB + 1);
    await upload(page, xlsxFile('grande.xlsx', big));
    await expect(errorsBox(page).locator('li')).toHaveText(['El archivo supera 1 MB']);
    await expect(saveButton(page)).toBeDisabled();

    const exact = ofSize(MIB);
    expect(exact.length).toBe(MIB);
    await upload(page, xlsxFile('justo.xlsx', exact));
    await expect(page.locator('.csv-ok')).toHaveText('1 filas válidas, listas para guardar.');
  });

  test('columnas erróneas: mismos mensajes que el CSV equivalente', async ({ page }) => {
    await openMeasurements(page, 'AVAIL · Disponibilidad');
    await upload(page, csvFile('avail-columnas.csv', fixture('avail-columnas.csv')));
    const fromCsv = await previewOf(page);
    expect(fromCsv.errors).toEqual([
      'Fila 1: Cabecera: faltan columnas valor (esperadas: fecha, unidad, valor)',
      'Fila 1: Cabecera: columnas no reconocidas valr, comentario',
    ]);
    await upload(page, xlsxFile('avail-columnas.xlsx', fixture('avail-columnas.xlsx')));
    expect(await previewOf(page)).toEqual(fromCsv);
    await expect(saveButton(page)).toBeDisabled();
  });

  test('un .xls antiguo o un texto renombrado a .xlsx se rechazan con mensaje', async ({ page }) => {
    await openMeasurements(page, 'AVAIL · Disponibilidad');
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    await upload(page, { name: 'viejo.xls', mimeType: 'application/vnd.ms-excel', buffer: ole });
    await expect(errorsBox(page)).toContainText('Excel antiguo (.xls)');
    await upload(page, xlsxFile('texto.xlsx', fixture('avail.csv')));
    await expect(errorsBox(page)).toContainText('no es un libro de Excel .xlsx válido');
  });
});

test.describe('V-07 · plantilla Excel descargada', () => {
  async function downloadTemplate(page) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Descargar plantilla Excel (.xlsx)' }).click(),
    ]);
    return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
  }

  test('AVAIL: la plantilla se reimporta sin errores de cabecera y, rellena, da una vista previa válida', async ({ page }) => {
    await openMeasurements(page, 'AVAIL · Disponibilidad');
    const tpl = await downloadTemplate(page);
    expect(tpl.name).toBe('plantilla-mediciones-window_average.xlsx');
    expect(tpl.bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    // Tal cual se descarga: solo falta poner datos (ningún error de cabecera).
    await upload(page, xlsxFile(tpl.name, tpl.bytes));
    await expect(errorsBox(page).locator('li')).toHaveText(['El archivo no tiene filas de datos']);

    // Rellena como lo haría Excel: fecha como serie numérica y fecha como texto.
    const filled = fillTemplate(tpl.bytes, [[serial('2026-01-05'), 'Unidad Alfa', 99.9], ['2026-01-06', 'Unidad Beta', 99.5]]);
    await upload(page, xlsxFile(tpl.name, filled));
    expect(await previewOf(page)).toEqual({
      ok: '2 filas válidas, listas para guardar.',
      save: 'Guardar 2 mediciones',
      rows: [['2', '2026-01-05', 'Unidad Alfa', '99.9'], ['3', '2026-01-06', 'Unidad Beta', '99.5']],
    });
  });

  test('OBS: la plantilla rellena se guarda y aparece en las últimas mediciones', async ({ page }) => {
    await openMeasurements(page, 'OBS · Observabilidad');
    const tpl = await downloadTemplate(page);
    expect(tpl.name).toBe('plantilla-mediciones-coverage.xlsx');
    const app = `qa-v07-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const filled = fillTemplate(tpl.bytes, [[serial('2026-11-02'), 'Unidad Alfa', `${app}-a`, true], ['2026-11-02', 'unidad beta', `${app}-b`, false]]);
    await upload(page, xlsxFile(tpl.name, filled));
    await expect(page.locator('.csv-ok')).toHaveText('2 filas válidas, listas para guardar.');
    await page.getByRole('button', { name: 'Guardar 2 mediciones' }).click();
    await expect(page.locator('.form-status')).toHaveText('Se guardaron 2 mediciones.');
    const recent = page.getByRole('table', { name: 'Últimas mediciones' });
    await expect(recent).toContainText(`${app}-a: cumple`);
    await expect(recent).toContainText(`${app}-b: no cumple`);
  });
});
