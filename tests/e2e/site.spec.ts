import { test, expect, type Page } from '@playwright/test';
import type { Session } from '../../src/state/session';
const saved = (page: Page): Promise<Session> =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem('chordscape.session.v4')!),
  );
const nav = (page: Page, name: string) =>
  page
    .getByRole('navigation')
    .getByRole('button', { name, exact: true })
    .click();
const stop = (page: Page) =>
  page.getByRole('button', { name: '■ 停止', exact: true }).click();

test('every page shares its brand, logo and width, with a separate page title', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.name === 'mobile'
      ? { width: 320, height: 812 }
      : { width: 1280, height: 800 },
  );
  let width = 0;
  for (const [hash, title] of [
    ['play', 'ホーム'],
    ['generate', '生成'],
    ['library', 'コード辞典'],
    ['circle', '五度圏'],
    ['space', '和声空間'],
    ['settings', '設定'],
    ['listen', '聞き流し'],
  ]) {
    await page.goto(`./#${hash}`);
    await expect(page.locator('.brand')).toHaveText('Chordscape◌');
    await expect(page.locator('.brand-mark')).toBeVisible();
    await expect(page.locator('.app-header h1')).toHaveText(title);
    if (hash === 'play') {
      await expect(page.locator('.app-header h1')).toHaveClass('sr-only');
      await expect(page.locator('.app-header h1:not(.sr-only)')).toHaveCount(0);
    } else {
      await expect(page.locator('.app-header h1')).not.toHaveClass('sr-only');
    }
    const current = (await page.locator('main.app').boundingBox())!.width;
    if (!width) width = current;
    expect(current).toBe(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.locator('.brand').click();
  await expect(page).toHaveURL(/#play$/);
  await page.screenshot({
    path: info.outputPath('shared-header.png'),
    fullPage: true,
  });
});

test('manual inversion and octave edits stay visible and survive playback, comparison and reload', async ({
  page,
}, info) => {
  await page.goto('./');
  await expect(
    page.getByRole('combobox', { name: '配置', exact: true }),
  ).toHaveValue('manual');
  for (const name of ['C I', 'G V'])
    await page.getByRole('button', { name, exact: true }).click();
  await stop(page);
  await page.locator('.timeline .event').first().click();
  const editor = page.locator('.event-editor');
  await expect(editor.getByRole('spinbutton')).toBeVisible();
  await expect(editor.locator('details')).toHaveCount(0);
  await editor.getByRole('combobox').selectOption('1');
  await editor.getByRole('button', { name: '+1 oct', exact: true }).click();
  await expect(page.getByTestId('actual-bass')).toHaveText('E4');
  await expect
    .poll(async () => (await saved(page))?.events[0]?.notes)
    .toEqual([64, 67, 72]);
  const notes = (await saved(page)).events.map((e) => e.notes);
  await stop(page);
  await page
    .getByRole('button', { name: 'A: Rootを聴く', exact: true })
    .click();
  await expect(page.getByTestId('actual-bass')).toHaveText('E3');
  await stop(page);
  expect((await saved(page)).events.map((e) => e.notes)).toEqual(notes);
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(page.getByTestId('actual-bass')).toHaveText('E4');
  await stop(page);
  await page.reload();
  await page.locator('.timeline .event').first().click();
  await expect(page.getByTestId('actual-bass')).toHaveText('E4');
  expect((await saved(page)).events.map((e) => e.notes)).toEqual(notes);
  await page.screenshot({
    path: info.outputPath('manual-editor.png'),
    fullPage: true,
  });
});

test('generation page offers melody only after a progression exists', async ({
  page,
}, info) => {
  await page.goto('./#generate');
  await expect(
    page.getByRole('heading', { name: 'コードの生成', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '旋律の生成', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: '旋律を鳴らす', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '旋律を再生成', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  await expect(page.locator('.timeline .event')).toHaveCount(4);
  await expect.poll(async () => (await saved(page))?.events.length).toBe(4);
  const original = (await saved(page)).events.map((e) => [e.chord, e.notes]);
  await nav(page, '生成');
  await page.getByRole('button', { name: '旋律を再生成', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'ピアノロール', exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await saved(page)).events.every((e) => e.melody?.length))
    .toBe(true);
  expect((await saved(page)).events.map((e) => [e.chord, e.notes])).toEqual(
    original,
  );
  await page.screenshot({
    path: info.outputPath('generation-page.png'),
    fullPage: true,
  });
  await nav(page, 'ホーム');
  await page.getByRole('button', { name: '全消去', exact: true }).click();
  await nav(page, '生成');
  await expect(
    page.getByRole('button', { name: '旋律を再生成', exact: true }),
  ).toBeDisabled();
  await page.goto('./#melody');
  await expect(page.locator('.app-header h1')).toHaveText('生成');
});

test('harmonic reset clears context and voice leading while retaining key and style', async ({
  page,
}) => {
  await page.goto('./#space');
  await page.getByRole('combobox', { name: '和声空間の調' }).selectOption('D');
  await page.getByRole('button', { name: 'Jazz', exact: true }).click();
  for (const id of ['c', 'f', 'fm']) {
    const node = page.locator(`[data-node-id="${id}"]`);
    await node.click();
    await expect(node).toHaveAttribute('data-history', '0');
  }
  await expect(page.locator('.space-node[data-history]')).toHaveCount(3);
  await page.getByRole('button', { name: 'リセット', exact: true }).click();
  await expect(page.locator('.space-node[data-history]')).toHaveCount(0);
  await expect(page.locator('.space-node[data-suggestion]')).toHaveCount(0);
  await expect(page.locator('.space-node[data-sounding]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.getByTestId('audio-level').getAttribute('value').then(Number),
    )
    .toBe(0);
  await expect(
    page.getByRole('combobox', { name: '和声空間の調' }),
  ).toHaveValue('D');
  await expect(
    page.getByRole('button', { name: 'Jazz', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-node-id="c"]').click();
  await expect(page.locator('.space-readout')).toContainText('D3 · F♯3 · A3');
});
