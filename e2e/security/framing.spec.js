import { test, expect } from '@playwright/test';

// S-04 · categoría 4: clickjacking. frame-ancestors no aplica por <meta> y
// GitHub Pages no admite X-Frame-Options; src/security/anti-framing.js vacía y
// oculta el documento si la app está dentro de un marco. La página atacante
// y la víctima se sirven con page.route en dominios reservados (.example): la
// víctima es el build local reenviado tal cual (route.fetch a vite preview), así
// que el marco es de otro origen y nada sale del runner. (Un iframe directo a
// localhost desde otro origen lo bloquea Chrome con Private Network Access.)

const ATTACKER = 'http://atacante.example/';
const VICTIM = 'http://victima.example';

async function framedApp(page, baseURL, hash = '#/login') {
  const local = new URL(baseURL);
  const appUrl = `${VICTIM}${local.pathname}${hash}`;
  await page.route(/^http:\/\/victima\.example\//, async (route) => {
    const u = new URL(route.request().url());
    const response = await route.fetch({ url: `${local.origin}${u.pathname}${u.search}` });
    await route.fulfill({ response });
  });
  await page.route(ATTACKER, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>atacante</title><p>Haz clic</p><iframe id="victim" src="${appUrl}" width="800" height="600"></iframe>`,
    }),
  );
  await page.goto(ATTACKER);
  const frame = page.frameLocator('#victim');
  let f;
  await expect.poll(() => {
    f = page.frames().find((fr) => fr.url().includes('/practica_agente/'));
    return f ? f.url() : page.frames().map((fr) => fr.url()).join(' | ');
  }, { message: 'el iframe no navegó a la app' }).toContain('/practica_agente/');
  // Los module scripts son diferidos: se espera a que el anti-framing actúe y se
  // devuelve el estado completo para que un fallo sea diagnosticable.
  const state = () => f.evaluate(() => ({
    ready: document.readyState,
    framed: window.top !== window.self,
    htmlHidden: document.documentElement.hidden,
    bodyHidden: document.body?.hidden ?? null,
    app: Boolean(document.getElementById('app')),
    scripts: [...document.scripts].map((s) => s.src),
  })).catch((e) => ({ error: String(e) }));
  await expect.poll(state, { timeout: 10_000 }).toMatchObject({ framed: true, htmlHidden: true, bodyHidden: true, app: false });
  return { frame, f };
}

test('la app no se renderiza dentro de un iframe de otro origen', async ({ page, baseURL }) => {
  const { frame, f } = await framedApp(page, baseURL);
  await expect(frame.getByRole('button', { name: 'Entrar' })).toHaveCount(0);
  await expect(frame.getByLabel('Correo')).toHaveCount(0);
  expect(await f.evaluate(() => document.getElementById('app'))).toBeNull();
  expect(await f.evaluate(() => document.body.hidden && document.documentElement.hidden)).toBe(true);
});

test('una ruta de rol enmarcada tampoco se renderiza', async ({ page, baseURL }) => {
  const { frame } = await framedApp(page, baseURL, '#/gestora');
  await expect(frame.locator('header, main, form, button')).toHaveCount(0);
});

test('fuera de un marco la app se muestra con normalidad', async ({ page }) => {
  await page.goto('./#/login');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.hidden)).toBe(false);
});
