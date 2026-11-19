import { test, expect } from '@playwright/test';

// C-02 (desarrollador): excepciones del comité en #/comite/excepciones.
// Requiere Supabase local con supabase/seed.sql (usuarios ficticios).
// "Vencida -> el candado vuelve" se prueba en el motor
// (tests/engine/exceptions-c02.test.js): el front no evalúa candados.
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Local-Only-Pass-2026';
const API = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const UNIT_ALFA = '22222222-2222-4222-8222-000000000001';

async function login(page, email) {
  await page.goto('./#/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

function inDaysGye(days) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

test('C-02: el comité aprueba una excepción de inicio puntual y la revoca', async ({ page }) => {
  const tag = `E2E ${Date.now()}`;
  await login(page, 'comite@example.test');
  await expect(page).toHaveURL(/#\/comite$/);
  await page.getByRole('link', { name: 'Excepciones' }).click();
  await expect(page).toHaveURL(/#\/comite\/excepciones$/);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Excepciones del comité');

  // Validación en el cliente: change obligatorio para inicio puntual.
  await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Alfa' });
  await page.getByLabel('Motivo', { exact: true }).fill(`${tag} <img src=x onerror=alert(1)>`);
  await page.getByLabel('Vence el', { exact: true }).fill(inDaysGye(30));
  await page.getByRole('button', { name: 'Aprobar excepción' }).click();
  await expect(page.locator('#exc-change-error')).toHaveText('Indica el change que se autoriza.');

  await page.getByLabel('Change autorizado', { exact: true }).fill('CHG-E2E-1');
  await page.getByRole('button', { name: 'Aprobar excepción' }).click();

  const row = page.locator('tbody tr', { hasText: tag });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-status', 'active');
  await expect(row).toContainText('Vigente');
  await expect(row).toContainText('CHG-E2E-1');
  await expect(row).toContainText('Unidad Alfa');
  // El motivo se muestra como texto, no como HTML.
  await expect(row.locator('img')).toHaveCount(0);
  await expect(row).toContainText('<img src=x onerror=alert(1)>');

  await row.getByRole('button', { name: /Revocar/ }).click();
  await expect(row).toHaveAttribute('data-status', 'revoked');
  await expect(row).toContainText('Revocada');
  await expect(row.getByRole('button', { name: /Revocar/ })).toHaveCount(0);
});

test('C-02: vencimiento mayor al tope se rechaza en el formulario', async ({ page }) => {
  await login(page, 'comite@example.test');
  await expect(page).toHaveURL(/#\/comite$/); // sesión lista antes de navegar
  await page.goto('./#/comite/excepciones');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Excepciones del comité');
  await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Beta' });
  await page.getByLabel('Alcance', { exact: true }).selectOption('all');
  await expect(page.getByLabel('Change autorizado', { exact: true })).toBeHidden();
  await page.getByLabel('Motivo', { exact: true }).fill('Demasiado larga');
  await page.getByLabel('Vence el', { exact: true }).fill(inDaysGye(91));
  await page.getByRole('button', { name: 'Aprobar excepción' }).click();
  await expect(page.locator('#exc-expires-error')).toContainText('90 días');
});

test('C-02: el líder no ve la pantalla ni el formulario de excepciones', async ({ page }) => {
  await login(page, 'lider1@example.test');
  await expect(page).toHaveURL(/#\/lider$/);
  await expect(page.getByRole('link', { name: 'Excepciones' })).toHaveCount(0);
  await page.goto('./#/comite/excepciones');
  await expect(page).toHaveURL(/#\/lider$/);
  await expect(page.getByRole('button', { name: 'Aprobar excepción' })).toHaveCount(0);
});

test('C-02: el líder no puede crear excepciones por la API (RLS)', async ({ request }) => {
  test.skip(!API || !KEY, 'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY no definidos');
  const auth = await request.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email: 'lider1@example.test', password: PASSWORD },
  });
  expect(auth.ok()).toBeTruthy();
  const { access_token: token } = await auth.json();
  const res = await request.post(`${API}/rest/v1/exceptions`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, Prefer: 'return=representation' },
    data: { unit_id: UNIT_ALFA, scope: 'all', reason: 'me lo apruebo', expires_on: inDaysGye(10) },
  });
  expect([401, 403]).toContain(res.status());
});
