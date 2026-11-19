import { test, expect } from '@playwright/test';

// F-05 QA: casos que login.spec.js no cubre. Criterio: "entra con cada rol de seed y
// llega a su vista". El seed no tiene usuarios con varios roles ni sin rol; para esos
// casos se inicia sesión de verdad y se intercepta solo la consulta a user_roles
// (no se añaden datos al seed).
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Local-Only-Pass-2026';

async function login(page, email, password = PASSWORD) {
  await page.goto('./#/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

function mockRoles(page, rows, status = 200) {
  return page.route('**/rest/v1/user_roles*', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(rows) }),
  );
}

const heading = (page) => page.getByRole('heading', { level: 2 });

// Todos los usuarios del seed, no solo uno por rol.
const SEED = [
  { email: 'custodio2@example.test', path: '/custodio', title: 'Custodio de indicador', scope: 'Indicadores a tu cargo: 3.' },
  { email: 'custodio1@example.test', path: '/custodio', title: 'Custodio de indicador', scope: 'Indicadores a tu cargo: 1.' },
  { email: 'lider1@example.test', path: '/lider', title: 'Líder de unidad', scope: 'Unidades a tu cargo: 1.' },
  { email: 'lider2@example.test', path: '/lider', title: 'Líder de unidad', scope: 'Unidades a tu cargo: 1.' },
  { email: 'lider3@example.test', path: '/lider', title: 'Líder de unidad', scope: 'Unidades a tu cargo: 1.' },
];

for (const u of SEED) {
  test(`QA: ${u.email} llega a ${u.path} con su alcance`, async ({ page }) => {
    await login(page, u.email);
    await expect(page).toHaveURL(new RegExp(`#${u.path}$`));
    await expect(heading(page)).toHaveText(u.title);
    await expect(page.locator('.scope')).toHaveText(u.scope);
    // Un solo rol: no se ofrece cambiar de rol.
    await expect(page.getByRole('link', { name: 'Cambiar de rol' })).toHaveCount(0);
  });
}

test('QA: la sesión persiste al recargar y se queda en la vista del rol', async ({ page }) => {
  await login(page, 'gestora@example.test');
  await expect(page).toHaveURL(/#\/gestora$/);
  await page.reload();
  await expect(page).toHaveURL(/#\/gestora$/);
  await expect(heading(page)).toHaveText('Gestora de KPIs');
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
});

test('QA: tras cerrar sesión, recargar no recupera la sesión', async ({ page }) => {
  await login(page, 'custodio1@example.test');
  await expect(page).toHaveURL(/#\/custodio$/);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await page.goto('./#/custodio');
  await page.reload();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
});

test('QA: con sesión, ir a #/login o a una ruta inválida lleva a la vista propia', async ({ page }) => {
  await login(page, 'comite@example.test');
  await expect(page).toHaveURL(/#\/comite$/);
  for (const hash of ['#/login', '#/no-existe', '#/inicio', '#/sin-rol', '#/COMITE/']) {
    await page.goto(`./${hash}`);
    await expect(page).toHaveURL(/#\/comite$/);
    await expect(heading(page)).toHaveText('Comité de delivery');
  }
});

test('QA: navegación directa (carga en frío) a ruta ajena con sesión redirige a la propia', async ({ page }) => {
  await login(page, 'custodio1@example.test');
  await expect(page).toHaveURL(/#\/custodio$/);
  await page.goto('./#/gestora');
  await page.reload();
  await expect(page).toHaveURL(/#\/custodio$/);
  await expect(heading(page)).toHaveText('Custodio de indicador');
});

test('QA: sin sesión, una ruta inválida lleva a login', async ({ page }) => {
  await page.goto('./#/no-existe');
  await expect(page).toHaveURL(/#\/login$/);
});

test('QA: campos vacíos muestran aviso sin intentar entrar', async ({ page }) => {
  let authCalls = 0;
  await page.route('**/auth/v1/token*', (route) => { authCalls++; return route.continue(); });
  await page.goto('./#/login');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Escribe tu correo y tu contraseña.');
  expect(authCalls).toBe(0);
});

test('QA: usuario con varios roles ve el menú de elección y entra a cada uno', async ({ page }) => {
  await mockRoles(page, [
    { role: 'custodian', unit_id: null, indicator_id: '33333333-3333-4333-8333-000000000001' },
    { role: 'unit_leader', unit_id: '22222222-2222-4222-8222-000000000001', indicator_id: null },
  ]);
  await login(page, 'lider1@example.test');
  await expect(page).toHaveURL(/#\/inicio$/);
  await expect(heading(page)).toHaveText('Elige con qué rol entrar');
  const links = page.locator('.role-list a');
  await expect(links).toHaveText(['Custodio de indicador', 'Líder de unidad']);

  await page.getByRole('link', { name: 'Líder de unidad' }).click();
  await expect(page).toHaveURL(/#\/lider$/);
  await expect(heading(page)).toHaveText('Líder de unidad');

  await page.getByRole('link', { name: 'Cambiar de rol' }).click();
  await expect(page).toHaveURL(/#\/inicio$/);
  await page.getByRole('link', { name: 'Custodio de indicador' }).click();
  await expect(page).toHaveURL(/#\/custodio$/);

  // Rol que no tiene: vuelve al menú, no a una vista ajena.
  await page.goto('./#/gestora');
  await expect(page).toHaveURL(/#\/inicio$/);
  await expect(page.getByText('Gestora de KPIs')).toHaveCount(0);
});

test('QA: usuario autenticado sin roles ve #/sin-rol y ninguna vista de rol', async ({ page }) => {
  await mockRoles(page, []);
  await login(page, 'lider2@example.test');
  await expect(page).toHaveURL(/#\/sin-rol$/);
  await expect(heading(page)).toHaveText('Sin acceso');
  for (const hash of ['#/gestora', '#/lider', '#/inicio']) {
    await page.goto(`./${hash}`);
    await expect(page).toHaveURL(/#\/sin-rol$/);
  }
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
});

test('QA: si falla la carga de roles, se muestra el error y no se entra a ninguna vista', async ({ page }) => {
  await mockRoles(page, { message: 'boom' }, 500);
  await login(page, 'gestora@example.test');
  await expect(page).toHaveURL(/#\/sin-rol$/);
  await expect(page.getByRole('alert')).toHaveText('No se pudieron cargar tus permisos. Inténtalo de nuevo.');
});
