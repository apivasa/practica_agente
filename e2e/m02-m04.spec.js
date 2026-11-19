import { test, expect } from '@playwright/test';

// M-02, M-03, M-04 contra Supabase local con los usuarios ficticios del seed.
// Cada corrida usa códigos y periodos propios para poder repetirse sobre la
// misma BD (reintentos de Playwright).
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Local-Only-Pass-2026';
const CUSTODIO3_ID = '11111111-1111-4111-8111-000000000008';

async function login(page, email) {
  await page.goto('./#/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  // Espera a que el login termine de redirigir antes de navegar a otra ruta.
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/(login)?$/);
}

async function logout(page) {
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/#\/login$/);
}

const status = (page) => page.locator('.form-status');
const rowOf = (page, code) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: code, exact: true }) });
const unique = () => `E2E${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;

test.describe('M-02 · indicadores (gestora)', () => {
  test('la gestora crea un indicador nuevo no previsto y queda evaluable para su custodio', async ({ page }) => {
    const code = unique();
    await login(page, 'gestora@example.test');
    await expect(page).toHaveURL(/#\/gestora$/);
    await page.getByRole('link', { name: 'Indicadores' }).click();
    await expect(page).toHaveURL(/#\/gestora\/indicadores$/);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Indicadores');
    await expect(page.getByRole('cell', { name: 'VULN', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Nuevo indicador' }).click();
    await page.getByLabel('Código', { exact: true }).fill(code);
    await page.getByLabel('Nombre', { exact: true }).fill('Tiempo de aprovisionamiento (e2e)');
    await page.getByLabel('Tipo de medición').selectOption('window_average');
    await page.getByLabel('Sentido').selectOption('lower_is_better');
    await page.getByLabel('Ventana (días)').fill('15');
    // Primero un error de coherencia: con "menos es mejor" verde <= amarillo.
    await page.getByLabel('Umbral verde', { exact: true }).fill('48');
    await page.getByLabel('Umbral amarillo', { exact: true }).fill('24');
    await page.getByLabel('Custodio', { exact: true }).selectOption(CUSTODIO3_ID);
    await page.getByRole('button', { name: 'Guardar indicador' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'menos es mejor' })).toBeVisible();

    await page.getByLabel('Umbral verde', { exact: true }).fill('24');
    await page.getByLabel('Umbral amarillo', { exact: true }).fill('48');
    await page.getByRole('button', { name: 'Agregar categoría' }).click();
    await page.getByLabel('Categoría 1', { exact: true }).fill('Urgente');
    await page.getByLabel('Verde de categoría 1').fill('8');
    await page.getByLabel('Amarillo de categoría 1').fill('16');
    await page.getByLabel('Mínimo de muestra').fill('2');
    await page.getByRole('button', { name: 'Guardar indicador' }).click();
    await expect(status(page)).toHaveText(`Indicador ${code} guardado.`);
    const row = rowOf(page, code);
    await expect(row).toContainText('Activo');
    await expect(row).not.toContainText('incoherentes');

    // El custodio asignado lo ve en sus pantallas y puede registrar compromisos y mediciones.
    await logout(page);
    await login(page, 'custodio3@example.test');
    await expect(page).toHaveURL(/#\/custodio$/);
    await page.getByRole('link', { name: 'Mediciones' }).click();
    await expect(page.getByLabel('Indicador', { exact: true })).toContainText(code);
    await page.getByLabel('Indicador', { exact: true }).selectOption({ label: `${code} · Tiempo de aprovisionamiento (e2e)` });
    await page.getByLabel('Valor').fill('20');
    await page.getByRole('button', { name: 'Guardar medición' }).click();
    await expect(status(page)).toContainText('guardada');
    await expect(page.getByRole('table', { name: 'Últimas mediciones' })).toContainText('20');
  });

  test('la gestora desactiva y reactiva un indicador', async ({ page }) => {
    const code = unique();
    await login(page, 'gestora@example.test');
    await page.goto('./#/gestora/indicadores');
    await page.getByRole('button', { name: 'Nuevo indicador' }).click();
    await page.getByLabel('Código', { exact: true }).fill(code);
    await page.getByLabel('Nombre', { exact: true }).fill('Indicador temporal (e2e)');
    await page.getByLabel('Umbral verde', { exact: true }).fill('90');
    await page.getByLabel('Umbral amarillo', { exact: true }).fill('80');
    await page.getByRole('button', { name: 'Guardar indicador' }).click();
    await expect(status(page)).toHaveText(`Indicador ${code} guardado.`);
    await page.getByRole('button', { name: `Desactivar ${code}` }).click();
    await expect(rowOf(page, code)).toContainText('Inactivo');
    await page.getByRole('button', { name: `Activar ${code}` }).click();
    await expect(rowOf(page, code)).toContainText('Activo');
  });

  test('un custodio que pide #/gestora/indicadores vuelve a su inicio', async ({ page }) => {
    await login(page, 'custodio1@example.test');
    await expect(page).toHaveURL(/#\/custodio$/);
    await page.goto('./#/gestora/indicadores');
    await expect(page).toHaveURL(/#\/custodio$/);
    await expect(page.getByRole('button', { name: 'Nuevo indicador' })).toHaveCount(0);
  });
});

test.describe('M-03 · compromisos (custodio)', () => {
  test('el custodio registra un umbral negociado que sobrescribe el general', async ({ page }) => {
    const year = 2030 + Math.floor(Math.random() * 60);
    const period = `${year}-Q${1 + Math.floor(Math.random() * 4)}`;
    await login(page, 'custodio2@example.test');
    await page.getByRole('link', { name: 'Compromisos' }).click();
    await expect(page).toHaveURL(/#\/custodio\/compromisos$/);
    await page.getByLabel('Indicador', { exact: true }).selectOption({ label: 'AVAIL · Disponibilidad' });
    await expect(page.locator('.general-thresholds')).toHaveText('Umbral general: verde 99.9, amarillo 99.5.');

    await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Beta' });
    await page.getByLabel('Periodo').fill(period);
    // Incoherente con "más es mejor": se rechaza con mensaje.
    await page.getByLabel('Umbral verde negociado').fill('99');
    await page.getByLabel('Umbral amarillo negociado').fill('99.5');
    await page.getByRole('button', { name: 'Guardar compromiso' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'más es mejor' })).toBeVisible();

    await page.getByLabel('Umbral verde negociado').fill('99.5');
    await page.getByLabel('Umbral amarillo negociado').fill('99');
    await page.getByRole('button', { name: 'Guardar compromiso' }).click();
    await expect(status(page)).toHaveText(`Compromiso de Unidad Beta para ${period} guardado.`);
    const row = rowOf(page, period);
    await expect(row.getByRole('cell')).toHaveText(['Unidad Beta', period, '99.5', '99', 'Negociado', '—', 'Editar']);
  });

  test('meta acumulada: paquete por categoría', async ({ page }) => {
    const period = `${2030 + Math.floor(Math.random() * 60)}-0${1 + Math.floor(Math.random() * 9)}`;
    await login(page, 'custodio1@example.test');
    await page.goto('./#/custodio/compromisos');
    await expect(page.getByLabel('Indicador', { exact: true })).toContainText('VULN');
    await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Gamma' });
    await page.getByLabel('Periodo').fill(period);
    await page.getByLabel('Paquete P0P1').fill('1500');
    await page.getByLabel('Paquete P2P3').fill('500');
    await page.getByRole('button', { name: 'Guardar compromiso' }).click();
    await expect(status(page)).toContainText('guardado');
    const row = rowOf(page, period);
    await expect(row).toContainText('P0P1: 1500, P2P3: 500');
    await expect(row).toContainText('General');
  });
});

test.describe('M-04 · mediciones (custodio)', () => {
  test('CSV con errores se rechaza fila a fila con mensaje y no guarda nada', async ({ page }) => {
    await login(page, 'custodio2@example.test');
    await page.getByRole('link', { name: 'Mediciones' }).click();
    await expect(page).toHaveURL(/#\/custodio\/mediciones$/);
    await page.getByLabel('Indicador', { exact: true }).selectOption({ label: 'AVAIL · Disponibilidad' });
    const csv = [
      'fecha,unidad,valor',
      '2026-02-30,Unidad Alfa,99.9',
      '2026-01-10,Unidad Inexistente,99.9',
      '2026-01-10,Unidad Alfa,-5',
      '2026-01-10,Unidad Alfa,"=HYPERLINK(""http://example.test"",""x"")"',
      '2026-01-11,Unidad Alfa,99.9',
    ].join('\n');
    await page.getByLabel('Archivo CSV').setInputFiles({ name: 'errores.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    const errors = page.locator('.csv-errors');
    await expect(errors).toContainText('El archivo tiene 4 errores; no se guardó nada.');
    await expect(errors.locator('li')).toHaveCount(4);
    await expect(errors.locator('li').nth(0)).toContainText('Fila 2: fecha: "2026-02-30" no es una fecha real');
    await expect(errors.locator('li').nth(1)).toContainText('Fila 3: unidad: "Unidad Inexistente" no existe');
    await expect(errors.locator('li').nth(2)).toContainText('Fila 4:');
    await expect(errors.locator('li').nth(3)).toContainText('Fila 5: valor: la celda empieza con =');
    await expect(page.getByRole('button', { name: /Guardar .*mediciones/ })).toBeDisabled();
  });

  test('CSV válido se carga y aparece en las últimas mediciones', async ({ page }) => {
    await login(page, 'custodio2@example.test');
    await page.goto('./#/custodio/mediciones');
    await page.getByLabel('Indicador', { exact: true }).selectOption({ label: 'OBS · Observabilidad' });
    const app = unique().toLowerCase();
    const csv = `fecha;unidad;app_id;cumple\r\n2026-11-02;Unidad Alfa;${app}-a;sí\r\n2026-11-02;unidad beta;${app}-b;no\r\n`;
    await page.getByLabel('Archivo CSV').setInputFiles({ name: 'ok.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.locator('.csv-ok')).toHaveText('2 filas válidas, listas para guardar.');
    await page.getByRole('button', { name: 'Guardar 2 mediciones' }).click();
    await expect(status(page)).toHaveText('Se guardaron 2 mediciones.');
    const recent = page.getByRole('table', { name: 'Últimas mediciones' });
    await expect(recent).toContainText(`${app}-a: cumple`);
    await expect(recent).toContainText(`${app}-b: no cumple`);
  });

  test('captura manual de vulnerabilidades con categoría y tipo', async ({ page }) => {
    await login(page, 'custodio1@example.test');
    await page.goto('./#/custodio/mediciones');
    await expect(page.getByLabel('Indicador', { exact: true })).toContainText('VULN');
    await page.getByLabel('Fecha').fill('2026-11-03');
    await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Beta' });
    await page.getByLabel('Valor').fill('1.5');
    await page.getByRole('button', { name: 'Guardar medición' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'entero' })).toBeVisible();
    await page.getByLabel('Valor').fill('37');
    await page.getByLabel('Categoría').selectOption('P0P1');
    await page.getByLabel('Tipo', { exact: true }).selectOption('detectada');
    await page.getByRole('button', { name: 'Guardar medición' }).click();
    await expect(status(page)).toHaveText('Medición del 2026-11-03 para Unidad Beta guardada.');
    await expect(page.getByRole('table', { name: 'Últimas mediciones' })).toContainText('37 · P0P1 · detectada');
  });
});

test.describe('usuarios del seed con varios roles o sin rol', () => {
  test('multirol@example.test (gestora y custodio) elige rol y solo ve indicadores activos', async ({ page }) => {
    await login(page, 'multirol@example.test');
    await expect(page).toHaveURL(/#\/inicio$/);
    await expect(page.locator('.role-list a')).toHaveText(['Gestora de KPIs', 'Custodio de indicador']);
    await page.getByRole('link', { name: 'Custodio de indicador' }).click();
    await page.getByRole('link', { name: 'Mediciones' }).click();
    await expect(page.getByText('No custodias indicadores activos.')).toBeVisible();
    await page.goto('./#/gestora/indicadores');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Indicadores');
  });

  test('sinrol@example.test entra pero solo ve "Sin acceso"', async ({ page }) => {
    await login(page, 'sinrol@example.test');
    await expect(page).toHaveURL(/#\/sin-rol$/);
    await page.goto('./#/custodio/mediciones');
    await expect(page).toHaveURL(/#\/sin-rol$/);
  });
});
