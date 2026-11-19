// S-04 — Utilidades de las pruebas e2e de seguridad del front.
// Supabase local (CI): VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY las
// exporta el job (ci.yml › e2e, seguridad.yml › dast) desde `supabase status`.
// En CI su ausencia es un fallo, no una omisión.
import { expect } from '@playwright/test';

export const PASSWORD = process.env.E2E_SEED_PASSWORD ?? 'Local-Only-Pass-2026';
export const SB_URL = process.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
export const SB_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function requireSupabase(test) {
  if (SB_URL && SB_KEY) return;
  if (process.env.CI) throw new Error('CI sin VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY');
  test.skip(true, 'requiere Supabase local');
}

/**
 * Instrumenta la página: diálogos (alert/confirm/prompt), violaciones de CSP y
 * errores de consola quedan registrados para que la prueba los compruebe.
 */
export async function instrument(page) {
  const seen = { dialogs: [], console: [] };
  page.on('dialog', async (d) => {
    seen.dialogs.push(d.message());
    await d.dismiss().catch(() => {});
  });
  page.on('console', (m) => {
    if (m.type() === 'error') seen.console.push(m.text());
  });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample });
    });
  });
  return seen;
}

export const cspViolations = (page) => page.evaluate(() => window.__csp ?? []);

export async function login(page, email, password = PASSWORD) {
  await page.goto('./#/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

/** Access token de un usuario del seed, directo contra Auth local. */
export async function tokenFor(request, email) {
  const res = await request.post(`${SB_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    data: { email, password: PASSWORD },
  });
  expect(res.ok(), `login API ${email}: ${res.status()}`).toBe(true);
  return (await res.json()).access_token;
}

export function rest(request, token) {
  const headers = {
    apikey: SB_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  return {
    insert: (table, data) => request.post(`${SB_URL}/rest/v1/${table}`, { headers, data }),
    remove: (table, id) => request.delete(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, { headers }),
  };
}
