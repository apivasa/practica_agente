import { test, expect } from '@playwright/test';

// F-05: login con los usuarios ficticios de supabase/seed.sql (solo entorno local)
// y enrutamiento por rol. Requiere Supabase local levantado y el build con
// VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Local-Only-Pass-2026';

const USERS = [
  { email: 'gestora@example.test', path: '/gestora', title: 'Gestora de KPIs' },
  { email: 'custodio1@example.test', path: '/custodio', title: 'Custodio de indicador' },
  { email: 'comite@example.test', path: '/comite', title: 'Comité de delivery' },
  { email: 'lider1@example.test', path: '/lider', title: 'Líder de unidad' },
];

async function login(page, email, password) {
  await page.goto('./#/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

for (const user of USERS) {
  test(`${user.email} entra y llega a ${user.path}`, async ({ page }) => {
    await login(page, user.email, PASSWORD);
    await expect(page).toHaveURL(new RegExp(`#${user.path}$`));
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(user.title);
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  });
}

test('contraseña incorrecta muestra un error genérico y no entra', async ({ page }) => {
  await login(page, 'gestora@example.test', 'contrasena-incorrecta');
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
  await expect(page).toHaveURL(/#\/login$/);
});

test('un correo inexistente recibe el mismo mensaje que una contraseña incorrecta', async ({ page }) => {
  await login(page, 'nadie@example.test', 'contrasena-incorrecta');
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
});

test('logout vuelve a login y las rutas de rol ya no son accesibles', async ({ page }) => {
  await login(page, 'comite@example.test', PASSWORD);
  await expect(page).toHaveURL(/#\/comite$/);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.goto('./#/comite');
  await expect(page).toHaveURL(/#\/login$/);
});

test('un líder que navega a #/gestora es redirigido a #/lider', async ({ page }) => {
  await login(page, 'lider1@example.test', PASSWORD);
  await expect(page).toHaveURL(/#\/lider$/);
  await page.goto('./#/gestora');
  await expect(page).toHaveURL(/#\/lider$/);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Líder de unidad');
  await expect(page.getByText('Gestora de KPIs')).toHaveCount(0);
});

test('sin sesión, una ruta de rol lleva a login', async ({ page }) => {
  await page.goto('./#/gestora');
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByLabel('Correo')).toBeVisible();
});

test('el registro abierto sigue cerrado (H-F03-06) aunque el login por correo esté activo', async ({ request }) => {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  test.skip(!url || !key, 'Requiere Supabase local');
  const res = await request.post(`${url}/auth/v1/signup`, {
    headers: { apikey: key, 'Content-Type': 'application/json' },
    data: { email: 'nuevo-registro@example.test', password: 'Otra-Pass-Local-2026' },
  });
  expect(res.ok()).toBe(false);
  const body = await res.json();
  expect(body.error_code).toBe('signup_disabled');
});
