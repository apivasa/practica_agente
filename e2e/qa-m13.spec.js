import { test, expect } from '@playwright/test';

// QA M-13 (H-QA-M12-01): las pantallas muestran un mensaje del formulario para |v| >= 2^53
// en lugar del error 23514 de la BD, y no guardan nada. Usuarios ficticios del seed.
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Local-Only-Pass-2026';
const RANGE = /fuera de rango.*2\^53/;

async function login(page, email) {
  await page.goto('./#/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/(login)?$/);
}

const unique = () => `QAM13${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;

test('QA M-13 · gestora: umbral 2^53 muestra mensaje de rango y no guarda', async ({ page }) => {
  const code = unique();
  await login(page, 'gestora@example.test');
  await page.goto('./#/gestora/indicadores');
  await page.getByRole('button', { name: 'Nuevo indicador' }).click();
  await page.getByLabel('Código', { exact: true }).fill(code);
  await page.getByLabel('Nombre', { exact: true }).fill('Tope QA M-13 (e2e)');
  await page.getByLabel('Tipo de medición').selectOption('window_average');
  await page.getByLabel('Sentido').selectOption('higher_is_better');
  await page.getByLabel('Umbral verde', { exact: true }).fill('9007199254740992');
  await page.getByLabel('Umbral amarillo', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Guardar indicador' }).click();
  await expect(page.getByRole('alert').filter({ hasText: RANGE })).toBeVisible();
  await expect(page.getByRole('cell', { name: code, exact: true })).toHaveCount(0);
});

test('QA M-13 · custodio: medición manual 2^53 y CSV con 2^53 rechazados con mensaje', async ({ page }) => {
  await login(page, 'custodio2@example.test');
  await page.goto('./#/custodio/mediciones');
  await page.getByLabel('Indicador', { exact: true }).selectOption({ label: 'AVAIL · Disponibilidad' });
  await page.getByLabel('Fecha').fill('2026-11-02');
  await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Alfa' });
  await page.getByLabel('Valor').fill('9007199254740992');
  await page.getByRole('button', { name: 'Guardar medición' }).click();
  await expect(page.getByRole('alert').filter({ hasText: RANGE })).toBeVisible();

  const csv = 'fecha,unidad,valor\n2026-11-02,Unidad Alfa,9007199254740991\n2026-11-02,Unidad Alfa,9007199254740992\n';
  await page.getByLabel('Archivo CSV').setInputFiles({ name: 'tope.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const errors = page.locator('.csv-errors');
  await expect(errors.locator('li')).toHaveCount(1);
  await expect(errors.locator('li').nth(0)).toContainText('Fila 3: valor: fuera de rango');
  await expect(page.getByRole('button', { name: /Guardar .*mediciones/ })).toBeDisabled();
});

test('QA M-13 · custodio: paquete 2^53 en compromiso muestra mensaje de rango', async ({ page }) => {
  const period = `${2030 + Math.floor(Math.random() * 60)}-0${1 + Math.floor(Math.random() * 9)}`;
  await login(page, 'custodio1@example.test');
  await page.goto('./#/custodio/compromisos');
  await expect(page.getByLabel('Indicador', { exact: true })).toContainText('VULN');
  await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Gamma' });
  await page.getByLabel('Periodo').fill(period);
  await page.getByLabel('Paquete P0P1').fill('9007199254740992');
  await page.getByRole('button', { name: 'Guardar compromiso' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Paquete de P0P1: fuera de rango/ })).toBeVisible();
});
