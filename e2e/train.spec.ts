import { expect, test } from '@playwright/test';

test('log a workout end to end', async ({ page }) => {
  await page.goto('/auth/test-login');
  await page.getByText('Train', { exact: true }).first().click();

  // Finish any leftover active session from a previous run.
  const resume = page.getByText('Resume workout');
  if (await resume.isVisible().catch(() => false)) {
    await resume.click();
    await page.getByRole('button', { name: 'Finish workout' }).click();
    await page.getByText('Train', { exact: true }).first().click();
  }

  await page.getByRole('button', { name: 'Empty workout' }).click();
  await page.getByRole('button', { name: '+ Add exercise' }).click();
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByText('Barbell Bench Press').click();

  await page.getByLabel('kg').fill('60');
  await page.getByLabel('reps').fill('10');
  await page.getByRole('button', { name: 'Log set' }).click();
  await expect(page.getByText('60kg × 10')).toBeVisible();

  await page.getByRole('button', { name: 'Finish workout' }).click();
  await expect(page.getByText('Barbell Bench Press')).toBeVisible(); // detail page
});
