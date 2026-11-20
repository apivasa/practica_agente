import { test, expect } from '@playwright/test';

// QA V-08 (tester): el candado de hoy refleja el mismo día tanto la aprobación como la
// revocación de una excepción "todo" (ADR 0012 punto 3: revocada se ignora desde la fecha de
// revocación en America/Guayaquil). Usa Unidad Alfa para no chocar con e2e/v08-lock-today.spec.js
// (Unidad Beta). El cierre guardado se sirve con page.route (la semilla solo tiene evaluaciones
// de 2027): Alfa en rojo dos meses seguidos del trimestre -> congelada.
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Local-Only-Pass-2026';
const API = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ALFA = '22222222-2222-4222-8222-000000000001';
const TAG = `QA V08 ${Date.now()}`;

const todayGye = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function addMonths(month, n) {
  const idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Dos meses consecutivos del mismo trimestre que terminan en el mes anterior o el actual. */
function closureMonths() {
  const current = todayGye().slice(0, 7);
  const pos = (Number(current.slice(5, 7)) - 1) % 3;
  if (pos === 0) return [addMonths(current, -2), addMonths(current, -1)];
  return [addMonths(current, -1), current];
}

const storedClosure = () => closureMonths().map((month, i) => ({
  id: `qa-v08-${month}`, unit_id: ALFA, indicator_id: null, month, color: 'red', value: null, sample_size: 1,
  reason: 'Cierre simulado QA V-08', escalation_level: i === 0 ? 'restricted' : 'frozen',
  restrictions: i === 0 ? ['no_new_change', 'no_backlog_additions', 'prioritize_run'] : ['freeze_all_change', 'all_capacity_to_run'],
  evaluated_at: `${month}-01T11:07:00Z`,
}));

async function serveClosure(page) {
  await page.route(/\/rest\/v1\/evaluations(\?|$)/, (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(storedClosure()) })
    : route.fallback()));
}

async function login(page, email) {
  await page.goto('./#/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

const inTenDays = () => {
  const [y, m, d] = todayGye().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 10)).toISOString().slice(0, 10);
};

test.describe('QA V-08 · aprobación y revocación el mismo día', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!API || !KEY, 'requiere VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY');

  test.afterAll(async ({ request }) => {
    const res = await request.post(`${API}/auth/v1/token?grant_type=password`, {
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      data: { email: 'comite@example.test', password: PASSWORD },
    });
    if (!res.ok()) return;
    const token = (await res.json()).access_token;
    const headers = { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const list = await request.get(`${API}/rest/v1/exceptions?select=id&revoked_at=is.null&reason=like.${encodeURIComponent(`${TAG}*`)}`, { headers });
    for (const { id } of list.ok() ? await list.json() : []) {
      await request.patch(`${API}/rest/v1/exceptions?id=eq.${id}`, { headers, data: { revoked_at: new Date().toISOString() } });
    }
  });

  test('antes de aprobar: el líder de Alfa ve "Congelada" en el candado de hoy', async ({ page }) => {
    await serveClosure(page);
    await login(page, 'lider1@example.test');
    const today = page.locator('.unit-lock-today');
    await expect(today).toContainText('Congelada');
    await expect(today).toContainText(`Según el cierre de ${closureMonths().at(-1)} y las excepciones vigentes al ${todayGye()}`);
  });

  test('el comité aprueba "todo" para Alfa: el líder ve "En excepción" sin restricciones el mismo día', async ({ page }) => {
    await serveClosure(page);
    await login(page, 'comite@example.test');
    await page.goto('./#/comite/excepciones');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Excepciones del comité');
    await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Alfa' });
    await page.getByLabel('Alcance', { exact: true }).selectOption('all');
    await page.getByLabel('Motivo', { exact: true }).fill(`${TAG} suspension`);
    await page.getByLabel('Vence el', { exact: true }).fill(inTenDays());
    await page.getByRole('button', { name: 'Aprobar excepción' }).click();
    await expect(page.locator('tbody tr', { hasText: `${TAG} suspension` })).toHaveAttribute('data-status', 'active');

    await page.goto('./#/comite');
    const cell = page.getByRole('table', { name: 'Matriz unidad por indicador' }).locator('tr[data-unit="Unidad Alfa"] .lock-today-cell');
    await expect(cell).toContainText('En excepción');
    await expect(cell.locator('.restrictions')).toHaveCount(0);

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await login(page, 'lider1@example.test');
    const today = page.locator('.unit-lock-today');
    await expect(today).toContainText('En excepción');
    await expect(today.locator('.restrictions')).toHaveCount(0);
  });

  test('el comité la revoca hoy: el líder vuelve a ver "Congelada" el mismo día', async ({ page }) => {
    await serveClosure(page);
    await login(page, 'comite@example.test');
    await page.goto('./#/comite/excepciones');
    const row = page.locator('tbody tr', { hasText: `${TAG} suspension` });
    await expect(row).toHaveAttribute('data-status', 'active');
    await row.getByRole('button', { name: /Revocar/ }).click();
    await expect(row).toHaveAttribute('data-status', 'revoked');

    await page.goto('./#/comite');
    const cell = page.getByRole('table', { name: 'Matriz unidad por indicador' }).locator('tr[data-unit="Unidad Alfa"] .lock-today-cell');
    await expect(cell).toContainText('Congelada');
    await expect(cell).not.toContainText('En excepción');

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await login(page, 'lider1@example.test');
    const today = page.locator('.unit-lock-today');
    await expect(today).toContainText('Congelada');
    await expect(today).toContainText('Se frena todo el change');
  });
});
