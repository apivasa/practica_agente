import { test, expect } from '@playwright/test';
import { instrument, cspViolations, login, tokenFor, requireSupabase, SB_URL, SB_KEY } from './_helpers.js';

// V-01 + V-02 + V-03 · Pentest de los tableros contra Supabase local (CI, después de
// scripts/ci/seed-evaluations.sh). Categorías 1 (RLS, IDOR, escritura de alertas)
// y 3/4 (XSS almacenado en excepciones que pintan el líder y el comité).

const UNIT = {
  alfa: '22222222-2222-4222-8222-000000000001',
  beta: '22222222-2222-4222-8222-000000000002',
  gamma: '22222222-2222-4222-8222-000000000003',
};
const LIDER1 = '11111111-1111-4111-8111-000000000005';
const DENIED = [401, 403];

const api = (request, token) => {
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  return {
    get: async (path) => {
      const r = await request.get(`${SB_URL}/rest/v1/${path}`, { headers });
      expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBe(true);
      return r.json();
    },
    patch: (path, data) => request.patch(`${SB_URL}/rest/v1/${path}`, { headers, data }),
    post: (path, data) => request.post(`${SB_URL}/rest/v1/${path}`, { headers, data }),
    del: (path) => request.delete(`${SB_URL}/rest/v1/${path}`, { headers }),
  };
};

const todayGye = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const plusDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

test.describe('V-01 · el líder no ve otras unidades', () => {
  test.beforeEach(() => requireSupabase(test));

  test('UI: toda fila que llega del API a la vista del líder es de su unidad', async ({ page }) => {
    const leaks = [];
    const seen = [];
    page.on('response', async (res) => {
      const url = res.url();
      if (!url.startsWith(`${SB_URL}/rest/v1/`) || res.request().method() !== 'GET' || !res.ok()) return;
      let body;
      try { body = await res.json(); } catch { return; }
      const table = new URL(url).pathname.split('/').pop();
      seen.push(table);
      for (const row of [].concat(body)) {
        if (!row || typeof row !== 'object') continue;
        const unit = table === 'units' ? row.id : row.unit_id;
        if (unit !== undefined && unit !== null && unit !== UNIT.alfa) leaks.push(`${table}: ${unit}`);
        if (table === 'alerts' && row.recipient_user_id && row.recipient_user_id !== LIDER1) leaks.push(`alerts: destinatario ${row.recipient_user_id}`);
      }
    });
    await login(page, 'lider1@example.test');
    await expect(page.getByRole('heading', { name: /^Unidad Alfa · / })).toBeVisible();
    await expect(page.locator('.alerts-inbox')).toBeVisible();
    await page.waitForTimeout(500);
    expect(leaks).toEqual([]);
    for (const t of ['evaluations', 'targets', 'commitments', 'measurements', 'exceptions', 'alerts']) {
      expect(seen, `la vista no consultó ${t}`).toContain(t);
    }
    const text = await page.locator('main, body').first().innerText();
    expect(text).not.toContain('Unidad Beta');
    expect(text).not.toContain('Unidad Gamma');
  });

  test('API (IDOR): filtros por otra unidad, or= y embebidos devuelven vacío', async ({ request }) => {
    const L = api(request, await tokenFor(request, 'lider1@example.test'));
    for (const t of ['evaluations', 'targets', 'commitments', 'measurements', 'exceptions', 'alerts']) {
      for (const u of [UNIT.beta, UNIT.gamma]) {
        expect(await L.get(`${t}?select=unit_id&unit_id=eq.${u}`), `${t} de ${u}`).toEqual([]);
      }
      const mixed = await L.get(`${t}?select=unit_id&or=(unit_id.eq.${UNIT.beta},unit_id.eq.${UNIT.gamma},unit_id.eq.${UNIT.alfa})`);
      expect(mixed.every((r) => r.unit_id === UNIT.alfa), `${t} con or=`).toBe(true);
      const notAlfa = await L.get(`${t}?select=unit_id&unit_id=neq.${UNIT.alfa}`);
      expect(notAlfa, `${t} con neq`).toEqual([]);
    }
    // Embebido desde una tabla visible hacia units: no trae otras unidades.
    const emb = await L.get('evaluations?select=unit_id,units(id,name)&limit=50');
    for (const r of emb) expect(r.units?.id ?? UNIT.alfa).toBe(UNIT.alfa);
    // Alertas de otros destinatarios: invisibles.
    expect(await L.get(`alerts?select=id&recipient_user_id=neq.${LIDER1}`)).toEqual([]);
  });

  test('rutas de otros roles (completitud V-03, matriz V-02) redirigen al inicio del líder', async ({ page }) => {
    await login(page, 'lider1@example.test');
    for (const r of ['#/gestora/completitud', '#/gestora/metas', '#/comite', '#/comite/excepciones']) {
      await page.goto(`./${r}`);
      await expect(page).toHaveURL(/#\/lider$/);
    }
    await expect(page.getByRole('table', { name: 'Matriz unidad por indicador' })).toHaveCount(0);
  });
});

test.describe('V-01/V-02 · marcar alerta como leída solo toca read_at', () => {
  test.beforeEach(() => requireSupabase(test));

  test('API: el líder no puede cambiar otra columna, ni alertas ajenas, ni crear o borrar', async ({ request }) => {
    const L = api(request, await tokenFor(request, 'lider1@example.test'));
    const G = api(request, await tokenFor(request, 'gestora@example.test'));
    const [own] = await L.get('alerts?select=*&order=sent_at.desc&limit=1');
    expect(own, 'lider1 sin alertas: ¿corrió seed-evaluations.sh?').toBeTruthy();

    for (const body of [
      { payload: { message: '<img src=x onerror=alert(1)>' } },
      { kind: 'exception_expired' },
      { recipient_user_id: '11111111-1111-4111-8111-000000000006' },
      { unit_id: UNIT.beta },
      { sent_at: '2000-01-01T00:00:00Z' },
      { read_at: new Date().toISOString(), payload: {} },
    ]) {
      const r = await L.patch(`alerts?id=eq.${own.id}`, body);
      expect(DENIED, `PATCH ${JSON.stringify(body)} → ${r.status()} ${await r.text()}`).toContain(r.status());
    }
    const [after] = await G.get(`alerts?select=*&id=eq.${own.id}`);
    for (const k of ['payload', 'kind', 'recipient_user_id', 'unit_id', 'sent_at', 'dedupe_key']) {
      expect(after[k], `${k} cambió`).toEqual(own[k]);
    }

    // read_at de una alerta ajena: 0 filas y sin cambio.
    const [foreign] = await G.get(`alerts?select=id,read_at&recipient_user_id=neq.${LIDER1}&read_at=is.null&limit=1`);
    if (foreign) {
      const r = await L.patch(`alerts?id=eq.${foreign.id}`, { read_at: new Date().toISOString() });
      expect(r.ok() ? await r.json() : [], `PATCH ajeno → ${r.status()}`).toEqual([]);
      const [still] = await G.get(`alerts?select=read_at&id=eq.${foreign.id}`);
      expect(still.read_at).toBeNull();
    }

    const ins = await L.post('alerts', { unit_id: UNIT.alfa, recipient_user_id: LIDER1, kind: 'color_change', payload: { message: 'forjada' } });
    expect(DENIED, `POST alerts → ${ins.status()}`).toContain(ins.status());
    const del = await L.del(`alerts?id=eq.${own.id}`);
    expect(del.ok() ? (await del.json()).length : 0, 'DELETE borró filas').toBe(0);
    expect(await G.get(`alerts?select=id&id=eq.${own.id}`)).toHaveLength(1);
  });

  test('UI: "Marcar como leída" envía un PATCH cuyo cuerpo es solo read_at', async ({ page, request }) => {
    // Deja una alerta propia sin leer (el destinatario puede volver read_at a null; es su
    // único privilegio de escritura), así la prueba no depende del orden de las demás.
    const L = api(request, await tokenFor(request, 'lider1@example.test'));
    // La más antigua de las 50 que muestra la bandeja (e2e/v01-v03 marca la más reciente).
    const mine = await L.get('alerts?select=id&order=sent_at.desc&limit=50');
    const own = mine.at(-1);
    expect(own, 'lider1 sin alertas: ¿corrió seed-evaluations.sh?').toBeTruthy();
    const reset = await L.patch(`alerts?id=eq.${own.id}`, { read_at: null });
    expect(reset.ok(), await reset.text()).toBe(true);
    const patches = [];
    page.on('request', (r) => {
      if (/\/rest\/v1\/alerts/.test(r.url()) && r.method() !== 'GET') patches.push({ method: r.method(), url: r.url(), body: r.postDataJSON() });
    });
    await login(page, 'lider1@example.test');
    await expect(page.locator('.alerts-inbox')).toBeVisible();
    const btn = page.locator(`.alert-item[data-alert-id="${own.id}"]`).getByRole('button', { name: /Marcar como leída/ });
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('.form-status')).toHaveText('Alerta marcada como leída.');
    expect(patches).toHaveLength(1);
    expect(patches[0].method).toBe('PATCH');
    expect(Object.keys(patches[0].body)).toEqual(['read_at']);
    expect(patches[0].url).toMatch(/id=eq\.[0-9a-f-]{36}/);
    expect(patches[0].url).toMatch(/read_at=is\.null/);
  });
});

test.describe('V-01/V-02 · XSS almacenado en excepciones', () => {
  const PAYLOAD = `<img src=x onerror="window.__xss='exc';alert('xss-exc')"><script>window.__xss='s'</script>`;
  const REF = `"><svg/onload=alert('xss-ref')>`;
  const created = [];

  test.beforeAll(async ({ request }) => {
    requireSupabase(test);
    const C = api(request, await tokenFor(request, 'comite@example.test'));
    const today = todayGye();
    for (const body of [
      { unit_id: UNIT.alfa, scope: 'all', reason: `${PAYLOAD} v01sec-all`, expires_on: plusDays(today, 3) },
      { unit_id: UNIT.alfa, scope: 'change_start', reason: `${PAYLOAD} v01sec-chg`, change_ref: REF, expires_on: plusDays(today, 3) },
    ]) {
      const r = await C.post('exceptions', body);
      expect(r.status(), await r.text()).toBe(201);
      const [row] = await r.json();
      expect(row.reason).toBe(body.reason);
      created.push(row.id);
    }
  });

  test.afterAll(async ({ request }) => {
    if (!created.length) return;
    const C = api(request, await tokenFor(request, 'comite@example.test'));
    for (const id of created) await C.patch(`exceptions?id=eq.${id}`, { revoked_at: new Date().toISOString() });
  });

  for (const who of [
    { email: 'lider1@example.test', route: '#/lider' },
    { email: 'comite@example.test', route: '#/comite' },
  ]) {
    test(`${who.email}: motivo y change_ref hostiles se muestran literales sin ejecutarse`, async ({ page }) => {
      const seen = await instrument(page);
      await login(page, who.email);
      await page.goto(`./${who.route}`);
      const box = page.locator('.exceptions-box');
      await expect(box).toContainText('v01sec-all');
      await expect(box).toContainText(`${PAYLOAD} v01sec-chg`);
      await expect(box).toContainText(REF);
      await page.waitForTimeout(300);
      expect(seen.dialogs).toEqual([]);
      expect(await page.evaluate(() => window.__xss)).toBeUndefined();
      expect(await cspViolations(page)).toEqual([]);
      expect(await page.locator('img[src="x"], svg[onload], [onerror], [onload], body script').count()).toBe(0);
    });
  }
});
