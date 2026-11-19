import { test, expect } from '@playwright/test';

// V-01, V-02 y V-03 contra Supabase local con los usuarios ficticios del seed.
// Las evaluaciones y alertas las deja scripts/ci/seed-evaluations.sh (el mismo
// scripts/evaluate.js de las Actions) antes de correr Playwright: cierres de 2027-01 y
// 2027-02 y ritmo diario del 2027-02-10.
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Local-Only-Pass-2026';
const API = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ALFA = '22222222-2222-4222-8222-000000000001';
const VULN = '33333333-3333-4333-8333-000000000001';

async function login(page, email) {
  await page.goto('./#/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/(login)?$/);
}

/** Sesión por la API (clave publicable + usuario del seed) para verificar RLS. */
async function apiToken(request, email) {
  const res = await request.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    data: { email, password: PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).access_token;
}

async function apiGet(request, token, path) {
  const res = await request.get(`${API}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

const todayGye = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const unreadCount = async (page) => Number((await page.locator('.alerts-count').textContent()).replace(/\D/g, ''));

test.describe('V-01 · vista del líder', () => {
  test('el líder ve solo su unidad: color, meta mensual, ritmo, restricciones y alertas', async ({ page }) => {
    await login(page, 'lider1@example.test');
    await expect(page).toHaveURL(/#\/lider$/);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Líder de unidad');
    await expect(page.getByRole('heading', { name: 'Unidad Alfa · 2027-02' })).toBeVisible();
    await expect(page.locator('.unit-color')).toContainText('Amarillo');
    const escalation = page.locator('.unit-escalation');
    await expect(escalation).toContainText('Restringida');
    await expect(escalation).toContainText('No se inicia change nuevo');

    const table = page.getByRole('table', { name: 'Mis indicadores' });
    const vuln = table.locator('tr[data-indicator="VULN"]');
    await expect(vuln).toContainText('Meta acumulada de 2027-02: 1333');
    await expect(vuln).toContainText('Atrasada');
    await expect(table.locator('tr[data-indicator="AVAIL"]')).toContainText('Verde ≥ 99,9');

    // Enero: verde y operación normal.
    await page.getByLabel('Mes', { exact: true }).selectOption('2027-01');
    await expect(page.getByRole('heading', { name: 'Unidad Alfa · 2027-01' })).toBeVisible();
    await expect(page.locator('.unit-color')).toContainText('Verde');
    await expect(page.locator('.unit-escalation')).toContainText('Operación normal');

    // Alfa no tiene excepciones; nada de otras unidades en la pantalla.
    await expect(page.locator('.exceptions-box')).toContainText('No hay excepciones vigentes.');
    await expect(page.getByText('Unidad Beta')).toHaveCount(0);
    await expect(page.getByText('Unidad Gamma')).toHaveCount(0);

    // Bandeja de alertas propias: marcar como leída baja el contador.
    await expect(page.locator('.alert-item').first()).toBeVisible();
    const before = await unreadCount(page);
    if (before > 0) {
      await page.locator('.alert-item').getByRole('button', { name: /Marcar como leída/ }).first().click();
      await expect(page.locator('.form-status')).toHaveText('Alerta marcada como leída.');
      await expect(page.locator('.alerts-count')).toHaveText(`Sin leer: ${before - 1}`);
    }
  });

  test('RLS: por la API el líder solo lee evaluaciones, unidades y alertas propias', async ({ request }) => {
    test.skip(!API || !KEY, 'requiere VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY');
    const token = await apiToken(request, 'lider1@example.test');
    const evaluations = await apiGet(request, token, 'evaluations?select=unit_id');
    expect(evaluations.length).toBeGreaterThan(0);
    expect(new Set(evaluations.map((e) => e.unit_id))).toEqual(new Set([ALFA]));
    const units = await apiGet(request, token, 'units?select=id');
    expect(units.map((u) => u.id)).toEqual([ALFA]);
    const exceptions = await apiGet(request, token, 'exceptions?select=unit_id');
    expect(exceptions).toEqual([]);
    const alerts = await apiGet(request, token, 'alerts?select=unit_id');
    expect(alerts.length).toBeGreaterThan(0);
    expect(new Set(alerts.map((a) => a.unit_id))).toEqual(new Set([ALFA]));
  });

  test('otro líder ve su excepción vigente y su unidad congelada', async ({ page }) => {
    await login(page, 'lider2@example.test');
    await expect(page.getByRole('heading', { name: 'Unidad Beta · 2027-02' })).toBeVisible();
    await expect(page.locator('.unit-color')).toContainText('Rojo');
    await expect(page.locator('.unit-escalation')).toContainText('Congelada');
    await expect(page.locator('.unit-escalation')).toContainText('Se frena todo el change');
    await expect(page.locator('.exceptions-box')).toContainText('Arranque urgente ficticio autorizado por el comité');
    await expect(page.getByText('Unidad Alfa')).toHaveCount(0);
  });
});

test.describe('V-02 · vista del comité', () => {
  test('el comité ve la matriz de las 3 unidades, alertas y excepciones; filtra por mes', async ({ page }) => {
    await login(page, 'comite@example.test');
    await expect(page).toHaveURL(/#\/comite$/);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Comité de delivery');
    const matrix = page.getByRole('table', { name: 'Matriz unidad por indicador' });
    await expect(matrix.locator('caption')).toHaveText('Color por unidad e indicador · 2027-02');
    // Otras pruebas e2e (p. ej. XSS de S-04) crean unidades: se exigen las 3 de la semilla.
    for (const name of ['Unidad Alfa', 'Unidad Beta', 'Unidad Gamma']) {
      await expect(matrix.locator(`tr[data-unit="${name}"]`)).toHaveCount(1);
    }
    for (const code of ['VULN', 'AVAIL', 'MTTR', 'OBS']) {
      await expect(matrix.getByRole('columnheader', { name: code, exact: true })).toBeVisible();
    }
    await expect(matrix.locator('tr[data-unit="Unidad Alfa"]')).toContainText('Restringida');
    await expect(matrix.locator('tr[data-unit="Unidad Beta"]')).toContainText('Congelada');
    await expect(matrix.locator('tr[data-unit="Unidad Gamma"]')).toContainText('Congelada');

    await page.getByLabel('Mes', { exact: true }).selectOption('2027-01');
    await expect(matrix.locator('caption')).toHaveText('Color por unidad e indicador · 2027-01');
    await expect(matrix.locator('tr[data-unit="Unidad Alfa"] td').first()).toHaveText('Verde');
    await expect(matrix.locator('tr[data-unit="Unidad Gamma"]')).toContainText('En excepción');

    const exceptions = page.locator('.exceptions-box');
    await expect(exceptions).toContainText('Arranque urgente ficticio autorizado por el comité');
    await expect(exceptions).toContainText('Contingencia ficticia: candados suspendidos');

    await expect(page.getByRole('heading', { name: 'Alertas recientes' })).toBeVisible();
    await expect(page.locator('.alert-item').first()).toBeVisible();
    await expect(page.locator('.alerts-inbox')).toContainText('Unidad Beta');
  });
});

test.describe('V-03 · completitud (gestora)', () => {
  test('la gestora ve el % cargado por custodio y KPI y los faltantes', async ({ page, request }) => {
    test.skip(!API || !KEY, 'requiere VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY');
    // El custodio de VULN carga hoy un dato de Unidad Alfa por la API (RLS de custodio).
    const token = await apiToken(request, 'custodio1@example.test');
    const res = await request.post(`${API}/rest/v1/measurements`, {
      headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { unit_id: ALFA, indicator_id: VULN, measured_on: todayGye(), value: 1, category: 'P0P1', kind: 'resolved', source: 'manual' },
    });
    expect(res.ok()).toBeTruthy();

    await login(page, 'gestora@example.test');
    await page.getByRole('link', { name: 'Completitud' }).click();
    await expect(page).toHaveURL(/#\/gestora\/completitud$/);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Completitud por custodio');
    await expect(page.getByLabel('Mes a evaluar')).toHaveValue(todayGye().slice(0, 7));

    const vulnBlock = page.locator('.custodian-block').filter({ has: page.locator('tr[data-indicator="VULN"]') });
    await expect(vulnBlock.getByRole('heading', { level: 3 })).toContainText(/VULN · usuario 11111111…0002: \d+ % cargado/);
    const vuln = vulnBlock.locator('tr[data-indicator="VULN"]');
    await expect(vuln).toContainText(/[1-9]\d* de \d+/);
    await expect(vuln).toContainText(/\d+ %/);
    await expect(vuln.locator('td').last()).not.toContainText('Unidad Alfa');

    // El custodio de AVAIL, MTTR y OBS agrupa sus tres KPIs.
    const ops = page.locator('.custodian-block').filter({ has: page.locator('tr[data-indicator="OBS"]') });
    await expect(ops.locator('tbody tr')).toHaveCount(3);

    // Mes anterior: misma estructura.
    const options = await page.getByLabel('Mes a evaluar').locator('option').allTextContents();
    expect(options).toHaveLength(2);
    await page.getByLabel('Mes a evaluar').selectOption({ index: 1 });
    await expect(page.locator('tr[data-indicator="VULN"]')).toContainText(/\d+ de \d+/);
  });
});
