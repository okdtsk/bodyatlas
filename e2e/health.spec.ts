import { expect, test } from '@playwright/test';

test('log a meal via quick-log and see totals', async ({ page }) => {
  const mealName = `E2E Meal ${Date.now()}`;
  await page.goto('/auth/test-login');
  await page.getByRole('button', { name: 'Quick log' }).click();
  await page.getByRole('button', { name: 'Log a meal' }).click();
  await page.getByRole('textbox', { name: 'Meal' }).fill(mealName);
  await page.getByLabel('kcal').fill('480');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(mealName)).toBeVisible();
});
