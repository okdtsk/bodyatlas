/**
 * Visual regression checks that jsdom structurally cannot make.
 *
 * The unit suite renders into jsdom, which has no layout engine and does not load
 * webfonts, so it can assert that a class name is present but never that the user
 * sees anything. These four checks cover the gap: the Archivo numeral face actually
 * loads and is applied, icons occupy real geometry (a zero-sized SVG renders as
 * nothing while passing every DOM query), and both themes paint an explicit ground
 * at mobile and desktop widths.
 *
 * Screenshots land in e2e/__visual__/ (gitignored) for eyeballing after a change.
 */
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'e2e/__visual__';

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test('Archivo numeral face loads and is applied', async ({ page }) => {
  await page.goto('/auth/test-login');
  await expect(page.getByText('Today').first()).toBeVisible();
  await page.waitForFunction(() => document.fonts.status === 'loaded');

  // Deliberately not document.fonts.check(): it reports false here even when the
  // face is registered, loaded and applied. Assert the three things that decide
  // whether a user sees the face instead.
  // Faces load lazily, so poll rather than sampling once: document.fonts.status
  // reports "loaded" whenever nothing is pending, which can be true before a face
  // that a later paint will request has actually resolved.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          let status: string | null = null;
          document.fonts.forEach((f) => {
            if (f.family === 'Archivo Metric') status = f.status;
          });
          return status;
        }),
      { message: 'the Archivo Metric face should register and finish loading', timeout: 10000 },
    )
    .toBe('loaded');

  const applied = await page.evaluate(() => {
    const el = document.querySelector('.metric');
    return el ? getComputedStyle(el).fontFamily : null;
  });
  expect(applied, 'a .metric element should resolve to the metric stack').toContain(
    'Archivo Metric',
  );

  const res = await page.request.get('/fonts/archivo-metric.woff2');
  expect(res.status(), 'the woff2 must be served').toBe(200);
  expect((await res.body()).length).toBeGreaterThan(1000);
});

test('icons occupy real space in the tab bar and FAB', async ({ page }) => {
  await page.goto('/auth/test-login');
  await expect(page.getByText('Today').first()).toBeVisible();

  const tabIcons = await page.locator('.app-nav .tab svg').count();
  expect(tabIcons, 'all five tabs should render an icon').toBe(5);

  // A zero-sized icon renders as nothing; assert real geometry.
  const box = await page.locator('.app-nav .tab svg').first().boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(12);
  expect(box?.height ?? 0).toBeGreaterThan(12);

  const fab = await page.locator('.fab svg').boundingBox();
  expect(fab?.width ?? 0).toBeGreaterThan(12);
});

for (const theme of ['dark', 'light'] as const) {
  test(`renders at mobile and desktop in ${theme}`, async ({ page }) => {
    await page.goto('/auth/test-login');
    await expect(page.getByText('Today').first()).toBeVisible();
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);

    // Body must paint an explicit ground, not inherit transparent.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');

    await page.setViewportSize({ width: 390, height: 844 });
    // rise-in staggers to 180ms with fill-mode `both`, so an early screenshot
    // catches tiers still at opacity 0. Wait for every animation to settle.
    await page.waitForFunction(
      () => document.getAnimations().every((a) => a.playState === 'finished'),
      undefined,
      { timeout: 5000 },
    );
    await page.screenshot({ path: `${SHOTS}/today-${theme}-mobile.png`, fullPage: true });

    await page.getByText('Trends', { exact: true }).first().click();
    await expect(page.getByText('Weekly volume')).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `${SHOTS}/trends-${theme}-desktop.png`, fullPage: true });
  });
}
