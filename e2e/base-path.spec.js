import { test, expect } from '@playwright/test';

// Traza: F-01 "genera dist/ estático" para GitHub Pages bajo /practica_agente/.
// Si la base de Vite estuviera mal, los assets darían 404 aunque el <title> cargue.
test('todos los recursos se sirven bajo /practica_agente/ sin errores', async ({ page }) => {
  const fallidos = [];
  const errores = [];
  page.on('response', (r) => {
    if (r.status() >= 400) fallidos.push(`${r.status()} ${r.url()}`);
  });
  page.on('pageerror', (e) => errores.push(e.message));

  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const scripts = await page.locator('script[type="module"]').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of scripts) expect(src).toMatch(/^\/practica_agente\/assets\//);

  expect(fallidos).toEqual([]);
  expect(errores).toEqual([]);
});
