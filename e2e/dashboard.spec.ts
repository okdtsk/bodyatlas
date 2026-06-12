import { expect, test } from '@playwright/test';

test('today and trends render', async ({ page }) => {
  await page.goto('/auth/test-login');
  await expect(page.getByText('Today').first()).toBeVisible();
  await page.getByText('Trends', { exact: true }).first().click();
  await expect(page.getByText('Weekly volume')).toBeVisible();
});
