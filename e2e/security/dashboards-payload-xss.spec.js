import { test, expect } from '@playwright/test';
import { instrument, cspViolations, login, requireSupabase } from './_helpers.js';

// V-01 · V-02 — XSS desde datos que escribe el backend (categorías 3 y 4). El IDOR, la
// escritura de alertas y "Marcar como leída" los cubre dashboards-v01-v03.spec.js.
// - XSS: textos que vienen de la BD y que escribe el backend (payload JSON de alerts,
//   razón y restricciones de evaluations) o el comité (motivo y ref. de excepciones) se
//   sirven hostiles (page.route sobre la respuesta de Supabase local) y deben pintarse
//   como texto literal, sin ejecutar nada.

const ALFA = '22222222-2222-4222-8222-000000000001';
const VULN = '33333333-3333-4333-8333-000000000001';
const ALERT_ID = '99999999-9999-4999-8999-000000000001';

const PAYLOADS = [
  `<img src=x onerror="window.__xss='img';alert('xss-img')">`,
  `"><script>window.__xss='script';alert('xss-script')</script>`,
  `<svg/onload=alert('xss-svg')>`,
  `'><a href="javascript:alert('xss-href')">x</a>`,
];
const P = (i) => `${PAYLOADS[i % PAYLOADS.length]} v0x-${i}`;

test.beforeEach(() => requireSupabase(test));

const month = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit',
}).format(new Date()).slice(0, 7);

function hostileRows(unitId) {
  const m = month();
  return {
    alerts: [{
      id: ALERT_ID, unit_id: unitId, recipient_user_id: 'x', kind: 'color_change',
      payload: { message: P(0), severity: 'high', unit: P(1) }, sent_at: `${m}-01T10:00:00Z`, read_at: null,
    }, {
      id: '99999999-9999-4999-8999-000000000002', unit_id: unitId, recipient_user_id: 'x', kind: P(2),
      payload: { message: { nested: P(3) } }, sent_at: P(3), read_at: null,
    }],
    evaluations: [
      { id: 'e1', unit_id: unitId, indicator_id: null, month: m, color: P(1), value: P(2), sample_size: 1, reason: P(3), escalation_level: P(0), restrictions: [P(1), 'no_new_change'], evaluated_at: `${m}-01T10:00:00Z` },
      { id: 'e2', unit_id: unitId, indicator_id: VULN, month: m, color: 'red', value: 1, sample_size: 1, reason: P(2), escalation_level: 'frozen', restrictions: [], evaluated_at: `${m}-01T10:00:00Z` },
    ],
    exceptions: [{
      id: 'x1', unit_id: unitId, scope: 'all', reason: P(0), change_ref: P(1), expires_on: '2999-12-31',
      approved_by: 'x', created_at: `${m}-01T10:00:00Z`, revoked_at: null,
    }],
  };
}

/** Sirve las tablas indicadas con filas hostiles (solo GET); el resto va a Supabase local. */
async function serveHostile(page, rows) {
  for (const [table, data] of Object.entries(rows)) {
    await page.route(new RegExp(`/rest/v1/${table}(\\?|$)`), (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      : route.fallback()));
  }
}

async function assertInert(page, seen, where) {
  await page.waitForTimeout(300);
  expect(seen.dialogs, `${where}: diálogos`).toEqual([]);
  expect(await page.evaluate(() => window.__xss), `${where}: marcador`).toBeUndefined();
  expect(await cspViolations(page), `${where}: violaciones CSP`).toEqual([]);
  expect(await page.locator('img[src="x"], svg[onload], [onerror], [onload], a[href^="javascript:" i]').count(), `${where}: nodos inyectados`).toBe(0);
  expect(await page.locator('body script').count(), `${where}: <script> en body`).toBe(0);
}

test.describe('V-01/V-02 · XSS desde alerts, evaluations y exceptions', () => {
  for (const r of [
    { email: 'lider1@example.test', route: '#/lider', unit: ALFA },
    { email: 'comite@example.test', route: '#/comite', unit: ALFA },
  ]) {
    test(`${r.email}: payloads hostiles se pintan como texto y no se ejecutan`, async ({ page }) => {
      const seen = await instrument(page);
      await serveHostile(page, hostileRows(r.unit));
      await login(page, r.email);
      await page.goto(`./${r.route}`);
      await expect(page.locator('.alert-item').first()).toBeVisible();
      await expect(page.locator('.exceptions-box table')).toBeVisible();
      await assertInert(page, seen, r.email);
      const text = await page.locator('body').innerText();
      // payload.message de alerts y motivo/ref. de excepción, literales y completos.
      for (const i of [0, 1]) expect(text, `${r.email}: P(${i})`).toContain(P(i));
      // kind desconocido: literal, sin interpretarse.
      expect(text).toContain(P(2));
    });
  }
});
