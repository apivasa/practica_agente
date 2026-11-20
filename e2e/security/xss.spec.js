import { test, expect } from '@playwright/test';
import { instrument, cspViolations, login, tokenFor, rest, requireSupabase } from './_helpers.js';

// S-04 · T-FE-02 (XSS almacenado y reflejado). La gestora mete payloads por la
// API en los campos de texto que el front mostrará (nombre de unidad, nombre y
// descripción de indicador, claves de categoría). Después cada rol recorre sus
// rutas: ningún payload se ejecuta (sin diálogos, sin marcador global, sin
// violaciones de CSP) y ninguno crea nodos HTML. Cuando M-02..M-04 rendericen
// estos campos, la prueba exige además que el texto aparezca literal.

const PAYLOADS = [
  `<img src=x onerror="window.__xss='img';alert('xss-img')">`,
  `"><script>window.__xss='script';alert('xss-script')</script>`,
  `<svg/onload=alert('xss-svg')>`,
  `'><a href="javascript:alert('xss-href')">x</a>`,
  `{{constructor.constructor('alert(1)')()}}`,
];

const ROLES = [
  { email: 'gestora@example.test', routes: ['#/gestora', '#/gestora/indicadores', '#/gestora/completitud'] },
  { email: 'comite@example.test', routes: ['#/comite', '#/comite/excepciones'] },
  { email: 'custodio2@example.test', routes: ['#/custodio', '#/custodio/compromisos', '#/custodio/mediciones'] },
  { email: 'lider1@example.test', routes: ['#/lider'] },
];

const run = Date.now().toString(36);
const created = { units: [], indicators: [] };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  requireSupabase(test);
  const api = rest(request, await tokenFor(request, 'gestora@example.test'));
  for (const [i, p] of PAYLOADS.entries()) {
    const u = await api.insert('units', { name: `${p} s04-${run}-${i}` });
    expect(u.status(), await u.text()).toBe(201);
    created.units.push((await u.json())[0].id);
    const ind = await api.insert('indicators', {
      code: `S04_XSS_${run}_${i}`,
      name: p,
      description: `desc ${p}`,
      measurement_type: 'coverage',
      direction: 'higher_is_better',
      green_threshold: 90,
      yellow_threshold: 80,
      thresholds_by_category: { [p]: { green: 90, yellow: 80 } },
    });
    expect(ind.status(), await ind.text()).toBe(201);
    const row = (await ind.json())[0];
    // El dato viaja intacto: la BD no lo interpreta ni lo altera.
    expect(row.name).toBe(p);
    created.indicators.push(row.id);
  }
});

test.afterAll(async ({ request }) => {
  if (!created.units.length && !created.indicators.length) return;
  const api = rest(request, await tokenFor(request, 'gestora@example.test'));
  for (const id of created.indicators) await api.remove('indicators', id);
  for (const id of created.units) await api.remove('units', id);
});

async function assertInert(page, seen, where) {
  await page.waitForTimeout(300);
  expect(seen.dialogs, `${where}: diálogos`).toEqual([]);
  expect(await page.evaluate(() => window.__xss), `${where}: marcador`).toBeUndefined();
  expect(await cspViolations(page), `${where}: violaciones CSP`).toEqual([]);
  expect(await page.locator('img[src="x"], svg[onload], [onerror], [onload], a[href^="javascript:" i]').count(), `${where}: nodos inyectados`).toBe(0);
  expect(await page.locator('body script').count(), `${where}: <script> en body`).toBe(0);
  // Si un nombre de unidad se muestra, se muestra como texto literal y completo.
  const text = await page.locator('body').innerText();
  PAYLOADS.forEach((p, i) => {
    const marker = `s04-${run}-${i}`;
    if (text.includes(marker)) expect(text, `${where}: payload alterado`).toContain(`${p} ${marker}`);
  });
}

for (const r of ROLES) {
  test(`XSS almacenado: ${r.email} recorre sus rutas sin ejecutar payloads`, async ({ page }) => {
    const seen = await instrument(page);
    await login(page, r.email);
    await assertInert(page, seen, `${r.email} inicio`);
    for (const route of [...r.routes, '#/inicio', '#/']) {
      await page.goto(`./${route}`);
      await assertInert(page, seen, `${r.email} ${route}`);
    }
  });
}

const REFLECTED = [
  `#/<img src=x onerror="window.__xss='r1';alert(1)">`,
  `#/login"><script>window.__xss='r2'</script>`,
  `#/gestora?next=javascript:alert(1)`,
  `?q=<script>window.__xss='r3'</script>#/login`,
  `#/%3Csvg%2Fonload%3Dalert(1)%3E`,
];

for (const path of REFLECTED) {
  test(`XSS reflejado por URL no se ejecuta: ${path}`, async ({ page }) => {
    const seen = await instrument(page);
    await page.goto(`./${path}`);
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    await assertInert(page, seen, path);
  });
}
