import { test, expect } from '@playwright/test';

// M-07 (pruebas del desarrollador) contra Supabase local con los usuarios ficticios del seed.
// Cada corrida crea su propio indicador de meta acumulada sin categorías, así se puede repetir
// sobre la misma BD. Las fechas (2026-Q4) son pasadas: la captura no admite fechas futuras.
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Local-Only-Pass-2026';
const CUSTODIO3_ID = '11111111-1111-4111-8111-000000000008';
const NAME = 'Parches pendientes (e2e)';

async function login(page, email) {
  await page.goto('./#/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/(login)?$/);
}

async function logout(page) {
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/#\/login$/);
}

const status = (page) => page.locator('.form-status');
const unique = () => `M07${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
const unitRow = (page, name) => page.locator(`tr[data-unit="${name}"]`);

test.describe('M-07 · metas mensuales (gestora)', () => {
  test('la gestora propone, crea y edita la meta; el indicador pasa de "Sin evaluar" a color', async ({ page }) => {
    test.setTimeout(90_000);
    const code = unique();

    // 1. La gestora crea un indicador de meta acumulada sin categorías con custodio.
    await login(page, 'gestora@example.test');
    await page.goto('./#/gestora/indicadores');
    await page.getByRole('button', { name: 'Nuevo indicador' }).click();
    await page.getByLabel('Código', { exact: true }).fill(code);
    await page.getByLabel('Nombre', { exact: true }).fill(NAME);
    await page.getByLabel('Tipo de medición').selectOption('cumulative_target');
    await page.getByLabel('Sentido').selectOption('higher_is_better');
    await page.getByLabel('Ventana (días)').fill('90');
    await page.getByLabel('Umbral verde', { exact: true }).fill('90');
    await page.getByLabel('Umbral amarillo', { exact: true }).fill('80');
    await page.getByLabel('Custodio', { exact: true }).selectOption(CUSTODIO3_ID);
    await page.getByRole('button', { name: 'Guardar indicador' }).click();
    await expect(status(page)).toHaveText(`Indicador ${code} guardado.`);
    await logout(page);

    // 2. El custodio registra el paquete trimestral y una medición resuelta.
    await login(page, 'custodio3@example.test');
    await page.goto('./#/custodio/compromisos');
    await page.getByLabel('Indicador', { exact: true }).selectOption({ label: `${code} · ${NAME}` });
    await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Alfa' });
    await page.getByLabel('Periodo').fill('2026-Q4');
    await page.getByLabel('Paquete total').fill('30');
    await page.getByRole('button', { name: 'Guardar compromiso' }).click();
    await expect(status(page)).toHaveText('Compromiso de Unidad Alfa para 2026-Q4 guardado.');

    await page.goto('./#/custodio/mediciones');
    await page.getByLabel('Indicador', { exact: true }).selectOption({ label: `${code} · ${NAME}` });
    await page.getByLabel('Fecha').fill('2026-10-15');
    await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Alfa' });
    await page.getByLabel('Valor').fill('10');
    await page.getByRole('button', { name: 'Guardar medición' }).click();
    await expect(status(page)).toHaveText('Medición del 2026-10-15 para Unidad Alfa guardada.');
    await logout(page);

    // 3. La gestora abre Metas: sin meta del mes, el indicador queda "Sin evaluar".
    await login(page, 'gestora@example.test');
    await page.getByRole('link', { name: 'Metas' }).click();
    await expect(page).toHaveURL(/#\/gestora\/metas$/);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Metas mensuales');
    await page.getByLabel('Indicador', { exact: true }).selectOption({ label: `${code} · ${NAME}` });
    await page.getByLabel('Mes', { exact: true }).fill('2026-10');
    await page.getByLabel('Mes', { exact: true }).press('Tab');
    await expect(page.getByRole('heading', { name: 'Registrar o editar meta de 2026-10' })).toBeVisible();
    const alfa = unitRow(page, 'Unidad Alfa');
    await expect(alfa).toContainText('Sin meta');
    await expect(alfa.locator('.badge')).toHaveText('Sin evaluar');
    await expect(alfa).toContainText('Falta la meta');

    // 4. "Proponer un tercio": 1/3 del paquete de 30 para el mes 1 del trimestre.
    await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Alfa' });
    await page.getByRole('button', { name: 'Proponer un tercio' }).click();
    await expect(page.getByLabel('Meta acumulada del mes')).toHaveValue('10');
    await expect(status(page)).toContainText('un tercio del paquete de 30');
    await page.getByRole('button', { name: 'Guardar meta' }).click();
    await expect(status(page)).toHaveText('Meta de Unidad Alfa para 2026-10 guardada: 10.');
    await expect(alfa.locator('td').nth(1)).toHaveText('10');
    await expect(alfa.locator('.badge')).toHaveText('Verde');

    // 5. Edición: la meta sube a 20 y el color pasa a rojo (10 de 20 = 50 %).
    await page.getByRole('button', { name: 'Editar meta de Unidad Alfa' }).click();
    await expect(page.getByLabel('Meta acumulada del mes')).toHaveValue('10');
    await page.getByLabel('Meta acumulada del mes').fill('20');
    await page.getByRole('button', { name: 'Guardar meta' }).click();
    await expect(status(page)).toHaveText('Meta de Unidad Alfa para 2026-10 guardada: 20.');
    await expect(alfa.locator('td').nth(1)).toHaveText('20');
    await expect(alfa.locator('.badge')).toHaveText('Rojo');

    // 6. Sin compromiso trimestral no hay propuesta; un valor negativo se rechaza.
    await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Beta' });
    await page.getByRole('button', { name: 'Proponer un tercio' }).click();
    await expect(page.getByRole('alert')).toContainText('Sin compromiso trimestral (2026-Q4)');
    await page.getByLabel('Meta acumulada del mes').fill('-1');
    await page.getByRole('button', { name: 'Guardar meta' }).click();
    await expect(page.getByRole('alert')).toContainText('mayor o igual que 0');
    await expect(unitRow(page, 'Unidad Beta')).toContainText('Sin meta');
  });

  for (const [email, home] of [
    ['custodio1@example.test', '#/custodio'],
    ['comite@example.test', '#/comite'],
    ['lider1@example.test', '#/lider'],
  ]) {
    test(`${email} que pide #/gestora/metas vuelve a su inicio`, async ({ page }) => {
      await login(page, email);
      await page.goto('./#/gestora/metas');
      await expect(page).toHaveURL(new RegExp(`${home}$`));
      await expect(page.getByRole('button', { name: 'Guardar meta' })).toHaveCount(0);
    });
  }
});
