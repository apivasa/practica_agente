import { test, expect } from '@playwright/test';

test('la home carga con el título de la app', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('App de control de capacidad RUN');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('App de control de capacidad RUN');
});
