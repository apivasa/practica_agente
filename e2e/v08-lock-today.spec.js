import { test, expect } from '@playwright/test';

// V-08 (desarrollador): candado vigente hoy en los tableros del líder y del comité.
// Las excepciones son reales: el comité las aprueba en #/comite/excepciones contra Supabase
// local, y el líder las ve el mismo día, sin correr la evaluación mensual.
// El cierre guardado (evaluations) se sirve con page.route porque las evaluaciones de la
// semilla son de 2027 (futuras) y el candado de hoy solo usa el cierre del mes actual o del
// anterior: se simula un cierre fresco de Unidad Beta en rojo dos meses seguidos (congelada).
// Unidad Beta: la semilla ya tiene un inicio puntual sin referencia; ninguna otra prueba
// crea excepciones de Beta. Lo creado aquí se revoca al final.
const PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Local-Only-Pass-2026';
const API = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const BETA = '22222222-2222-4222-8222-000000000002';
const TAG = `V08 e2e ${Date.now()}`;
const REF = `CHG-V08-${Date.now()}`;

const todayGye = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function inDaysGye(days) {
  const [y, m, d] = todayGye().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function addMonths(month, n) {
  const idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Meses de un cierre fresco con dos o tres meses del mismo trimestre (el último, vigente hoy). */
function freshMonths() {
  const current = todayGye().slice(0, 7);
  const pos = (Number(current.slice(5, 7)) - 1) % 3; // 0 = primer mes del trimestre
  if (pos === 0) return [addMonths(current, -3), addMonths(current, -2), addMonths(current, -1)];
  return Array.from({ length: pos + 1 }, (_, i) => addMonths(current, i - pos));
}

const FROZEN = ['freeze_all_change', 'all_capacity_to_run'];
const storedClosure = () => freshMonths().map((month, i) => ({
  id: `v08-${month}`, unit_id: BETA, indicator_id: null, month, color: 'red', value: null, sample_size: 1,
  reason: 'Cierre simulado para V-08', escalation_level: i === 0 ? 'restricted' : 'frozen',
  restrictions: i === 0 ? ['no_new_change', 'no_backlog_additions', 'prioritize_run'] : FROZEN,
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

async function approve(page, { scope, reason, changeRef }) {
  await page.goto('./#/comite/excepciones');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Excepciones del comité');
  await page.getByLabel('Unidad', { exact: true }).selectOption({ label: 'Unidad Beta' });
  await page.getByLabel('Alcance', { exact: true }).selectOption(scope);
  if (changeRef) await page.getByLabel('Change autorizado', { exact: true }).fill(changeRef);
  await page.getByLabel('Motivo', { exact: true }).fill(reason);
  await page.getByLabel('Vence el', { exact: true }).fill(inDaysGye(10));
  await page.getByRole('button', { name: 'Aprobar excepción' }).click();
  await expect(page.locator('tbody tr', { hasText: reason })).toHaveAttribute('data-status', 'active');
}

const lastClosure = () => freshMonths().at(-1);

test.describe('V-08 · candado vigente hoy', () => {
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

  test('inicio puntual con la unidad congelada: el comité lo ve autorizado sin levantar el congelamiento', async ({ page }) => {
    await serveClosure(page);
    await login(page, 'comite@example.test');
    await approve(page, { scope: 'change_start', reason: `${TAG} inicio puntual`, changeRef: REF });

    await page.goto('./#/comite');
    const matrix = page.getByRole('table', { name: 'Matriz unidad por indicador' });
    await expect(matrix.getByRole('columnheader', { name: 'Candado hoy', exact: true })).toBeVisible();
    const today = matrix.locator('tr[data-unit="Unidad Beta"] .lock-today-cell');
    await expect(today).toContainText('Congelada');
    await expect(today).toContainText('Se frena todo el change');
    await expect(today).toContainText(`Inicio autorizado: ${REF}`);
    await expect(today).toContainText(`Según el cierre de ${lastClosure()} y las excepciones vigentes al ${todayGye()}`);
  });

  test('el líder ve "Congelada" más "Inicio autorizado: REF" el mismo día', async ({ page }) => {
    await serveClosure(page);
    await login(page, 'lider2@example.test');
    await expect(page.getByRole('heading', { name: `Unidad Beta · ${lastClosure()}` })).toBeVisible();
    const today = page.locator('.unit-lock-today');
    await expect(today).toContainText('Candado vigente hoy');
    await expect(today).toContainText('Congelada');
    await expect(today).toContainText('Toda la capacidad va al RUN');
    await expect(today.locator('.authorized-start', { hasText: `Inicio autorizado: ${REF}` })).toHaveCount(1);
    // El cierre guardado sigue igual (no se reprocesa).
    await expect(page.locator('.unit-escalation')).toContainText(`Restricciones del cierre de ${lastClosure()}`);
    await expect(page.locator('.unit-escalation')).toContainText('Congelada');
  });

  test('suspensión total aprobada hoy: el comité ve "En excepción" sin esperar al cierre', async ({ page }) => {
    await serveClosure(page);
    await login(page, 'comite@example.test');
    await approve(page, { scope: 'all', reason: `${TAG} suspension total` });

    await page.goto('./#/comite');
    const row = page.getByRole('table', { name: 'Matriz unidad por indicador' }).locator('tr[data-unit="Unidad Beta"]');
    await expect(row.locator('.lock-today-cell')).toContainText('En excepción');
    await expect(row.locator('.lock-today-cell .restrictions')).toHaveCount(0);
  });

  test('el líder ve "En excepción" el mismo día; el cierre guardado sigue congelado', async ({ page }) => {
    await serveClosure(page);
    await login(page, 'lider2@example.test');
    await expect(page.getByRole('heading', { name: `Unidad Beta · ${lastClosure()}` })).toBeVisible();
    const today = page.locator('.unit-lock-today');
    await expect(today).toContainText('En excepción');
    await expect(today.locator('.restrictions')).toHaveCount(0);
    await expect(page.locator('.unit-escalation')).toContainText('Congelada');
    await expect(page.locator('.exceptions-box')).toContainText(`${TAG} suspension total`);
  });
});
