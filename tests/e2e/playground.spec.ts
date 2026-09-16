import { test, expect } from '@playwright/test';
test('audio, chords, keyboard and stop work on the production base path', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (/\.(js|css)(\?|$)/.test(response.url()) && response.status() >= 400)
      errors.push(response.url());
  });
  page.on('requestfailed', (request) => errors.push(request.url()));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Chordscape' })).toBeVisible();
  const enable = page.getByRole('button', { name: '音声を開始' });
  await enable.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '音声オン' })).toBeVisible();
  await page.getByRole('button', { name: 'Bdim vii°', exact: true }).click();
  await expect(page.getByTestId('chord-symbol')).toHaveText('Bdim');
  await expect(page.locator('[data-midi="59"]')).toHaveAttribute(
    'data-active',
    'true',
  );
  await page.getByRole('button', { name: 'C I', exact: true }).click();
  await page.getByRole('button', { name: 'Dm ii', exact: true }).click();
  await expect(page.getByTestId('chord-symbol')).toHaveText('Dm');
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.locator('[data-active="true"]')).toHaveCount(0);
  await page.waitForTimeout(1200);
  await expect(page.locator('[data-active="true"]')).toHaveCount(0);
  await page.getByLabel('言語').selectOption('en');
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
