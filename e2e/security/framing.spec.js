import { test, expect } from '@playwright/test';

// S-04 · categoría 4: clickjacking. frame-ancestors no aplica por <meta> y
// GitHub Pages no admite X-Frame-Options; src/security/anti-framing.js vacía y
// oculta el documento si la app está dentro de un marco. La página atacante se
// sirve con page.route (no sale del runner) en otro origen de bucle local
// (127.0.0.1 frente a localhost), para no chocar con Private Network Access.

const ATTACKER = 'http://127.0.0.1:4173/__atacante__.html';

async function framedApp(page, baseURL, hash = '#/login') {
  const appUrl = new URL(`./${hash}`, baseURL).href;
  await page.route(ATTACKER, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>atacante</title><p>Haz clic</p><iframe id="victim" src="${appUrl}" width="800" height="600"></iframe>`,
    }),
  );
  await page.goto(ATTACKER);
  const frame = page.frameLocator('#victim');
  const handle = await page.locator('#victim').elementHandle();
  const f = await handle.contentFrame();
  await f.waitForLoadState('load');
  // Deja que el módulo anti-framing se ejecute (los module scripts son diferidos).
  await f.waitForFunction(() => document.documentElement.hidden === true, null, { timeout: 10_000 });
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
