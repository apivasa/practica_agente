import { test, expect } from '@playwright/test';
import { instrument, cspViolations, login, requireSupabase } from './_helpers.js';

// V-08 — Candado vigente hoy (categorías 1, 3 y 4).
// - XSS: con un cierre fresco de Unidad Alfa congelada (rojo dos meses), las excepciones de
//   inicio puntual llegan con change_ref y motivo hostiles (page.route sobre la respuesta de
//   Supabase local). "Inicio autorizado: <payload>" debe pintarse literal en el bloque
//   .unit-lock-today del líder y en la columna "Candado hoy" del comité, sin ejecutar nada.
// - Defensa en profundidad sobre RLS: si la respuesta trajera una suspensión total de otra
//   unidad (Beta), el candado de hoy de Alfa sigue congelado y no muestra su referencia.
// - Solo vista: pintar el candado de hoy no hace ninguna escritura contra la API.
// Todo es simulado (solo GET servidos): no se crean ni modifican filas reales.

const ALFA = '22222222-2222-4222-8222-000000000001';
const BETA = '22222222-2222-4222-8222-000000000002';
const PAYLOADS = [
  `<img src=x onerror="window.__xss='img';alert('xss-img')">`,
  `"><script>window.__xss='script';alert('xss-script')</script>`,
  `<svg/onload=alert('xss-svg')>`,
  `'><a href="javascript:alert('xss-href')">x</a>`,
];
const REF = (i) => `${PAYLOADS[i]} v08-${i}`;
const BETA_REF = 'CHG-BETA-NO-DEBE-VERSE';

test.beforeEach(() => requireSupabase(test));

const todayGye = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const inDays = (n) => {
  const [y, m, d] = todayGye().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
function addMonths(month, n) {
  const idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
/** Cierre fresco: dos o tres meses del mismo trimestre en rojo, el último vigente hoy. */
function freshMonths() {
  const current = todayGye().slice(0, 7);
  const pos = (Number(current.slice(5, 7)) - 1) % 3;
  if (pos === 0) return [addMonths(current, -3), addMonths(current, -2), addMonths(current, -1)];
  return Array.from({ length: pos + 1 }, (_, i) => addMonths(current, i - pos));
}
const closure = (unit) => freshMonths().map((month, i) => ({
  id: `sec-v08-${unit.slice(-1)}-${month}`, unit_id: unit, indicator_id: null, month, color: 'red', value: null,
  sample_size: 1, reason: 'Cierre simulado (seguridad V-08)', escalation_level: i === 0 ? 'restricted' : 'frozen',
  restrictions: i === 0 ? ['no_new_change'] : ['freeze_all_change', 'all_capacity_to_run'],
  evaluated_at: `${month}-01T11:07:00Z`,
}));
const exceptions = () => [
  ...PAYLOADS.map((_, i) => ({
    id: `sec-v08-x${i}`, unit_id: ALFA, scope: 'change_start', reason: REF(i), change_ref: REF(i),
    expires_on: inDays(5), approved_by: 'x', created_at: `${todayGye()}T10:00:00Z`, revoked_at: null,
  })),
  // Fila de otra unidad: RLS no la entrega al líder; si llegara, no debe afectar a Alfa.
  { id: 'sec-v08-beta', unit_id: BETA, scope: 'all', reason: 'beta', change_ref: BETA_REF, expires_on: inDays(5), approved_by: 'x', created_at: `${todayGye()}T10:00:00Z`, revoked_at: null },
  { id: 'sec-v08-beta2', unit_id: BETA, scope: 'change_start', reason: 'beta', change_ref: BETA_REF, expires_on: inDays(5), approved_by: 'x', created_at: `${todayGye()}T10:00:00Z`, revoked_at: null },
];

async function serve(page, { withBeta }) {
  const writes = [];
  page.on('request', (req) => {
    if (/\/rest\/v1\//.test(req.url()) && req.method() !== 'GET' && req.method() !== 'HEAD' && req.method() !== 'OPTIONS'
      && !/\/rest\/v1\/alerts/.test(req.url())) writes.push(`${req.method()} ${req.url()}`);
  });
  const evals = [...closure(ALFA), ...(withBeta ? closure(BETA) : [])];
  await page.route(/\/rest\/v1\/evaluations(\?|$)/, (r) => (r.request().method() === 'GET'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(evals) }) : r.fallback()));
  await page.route(/\/rest\/v1\/exceptions(\?|$)/, (r) => (r.request().method() === 'GET'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(exceptions()) }) : r.fallback()));
  return writes;
}

async function assertInert(page, seen, where) {
  await page.waitForTimeout(300);
  expect(seen.dialogs, `${where}: diálogos`).toEqual([]);
  expect(await page.evaluate(() => window.__xss), `${where}: marcador`).toBeUndefined();
  expect(await cspViolations(page), `${where}: violaciones CSP`).toEqual([]);
  expect(await page.locator('img[src="x"], svg[onload], [onerror], [onload], a[href^="javascript:" i]').count(), `${where}: nodos inyectados`).toBe(0);
  expect(await page.locator('body script').count(), `${where}: <script> en body`).toBe(0);
}

test.describe('V-08 · candado de hoy con referencias de excepción hostiles', () => {
  test('líder: "Inicio autorizado: REF" literal, inerte, sigue congelada y sin datos de Beta', async ({ page }) => {
    const seen = await instrument(page);
    const writes = await serve(page, { withBeta: false });
    await login(page, 'lider1@example.test');
    await expect(page.getByRole('heading', { name: `Unidad Alfa · ${freshMonths().at(-1)}` })).toBeVisible();
    const box = page.locator('.unit-lock-today');
    await expect(box).toContainText('Congelada');
    await expect(box.locator('.authorized-start')).toHaveCount(PAYLOADS.length);
    for (let i = 0; i < PAYLOADS.length; i += 1) {
      await expect(box.locator('.authorized-start').nth(i)).toHaveText(`Inicio autorizado: ${REF(i)}`);
    }
    await expect(box).not.toContainText(BETA_REF);
    await expect(box).not.toContainText('En excepción');
    await assertInert(page, seen, 'líder');
    expect(writes, 'escrituras al pintar el candado de hoy').toEqual([]);
  });

  test('comité: columna "Candado hoy" literal e inerte; la suspensión de Beta no se cruza a Alfa', async ({ page }) => {
    const seen = await instrument(page);
    const writes = await serve(page, { withBeta: true });
    await login(page, 'comite@example.test');
    await page.goto('./#/comite');
    const matrix = page.getByRole('table', { name: 'Matriz unidad por indicador' });
    const alfa = matrix.locator('tr[data-unit="Unidad Alfa"] .lock-today-cell');
    const beta = matrix.locator('tr[data-unit="Unidad Beta"] .lock-today-cell');
    await expect(alfa).toContainText('Congelada');
    for (let i = 0; i < PAYLOADS.length; i += 1) await expect(alfa).toContainText(`Inicio autorizado: ${REF(i)}`);
    await expect(alfa).not.toContainText(BETA_REF);
    await expect(beta).toContainText('En excepción');
    await expect(beta).not.toContainText('v08-0');
    await assertInert(page, seen, 'comité');
    expect(writes, 'escrituras al pintar el candado de hoy').toEqual([]);
  });
});
