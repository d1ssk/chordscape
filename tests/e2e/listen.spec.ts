import { expect, test, type Page } from '@playwright/test';
import { openSync, readSync, closeSync, statSync } from 'node:fs';
async function openListen(page: Page) {
  await page.goto('./#library');
  await page.getByRole('button', { name: '聞き流し', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '聞き流し', exact: true }),
  ).toBeVisible();
}
async function prepare(page: Page) {
  await page.getByRole('button', { name: 'セットを作る', exact: true }).click();
  await expect(
    page.getByText('準備できました。「再生」で開始します。', { exact: true }),
  ).toBeVisible({ timeout: 90000 });
}
const audioValue = async (
  page: Page,
  field: 'paused' | 'currentTime' | 'duration' | 'loop' | 'ended',
) =>
  page
    .locator('audio')
    .evaluate((audio, field) => (audio as HTMLAudioElement)[field], field);
test('prepares an actual 20-minute named WAV, plays, seeks, pauses, stops and downloads credited audio', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  const speechRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/speech/ja/')) speechRequests.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./#library');
  await page
    .getByRole('combobox', { name: '根音', exact: true })
    .selectOption('F♯');
  await page.getByRole('button', { name: '聞き流し', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: '根音', exact: true }),
  ).toHaveValue('F♯');
  await expect(
    page.getByRole('combobox', { name: 'セットの長さ', exact: true }),
  ).toHaveValue('20');
  await prepare(page);
  expect(speechRequests).toHaveLength(5);
  expect(
    speechRequests.every(
      (url) => url.includes('chord-F-p1-') && url.endsWith('.mp3'),
    ),
  ).toBe(true);
  await expect(page.getByText('VOICEVOX Nemo', { exact: true })).toBeVisible();
  await expect.poll(() => audioValue(page, 'duration')).toBe(1200);
  expect(await audioValue(page, 'paused')).toBe(true);
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect.poll(() => audioValue(page, 'currentTime')).toBeGreaterThan(0.1);
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  expect(await audioValue(page, 'paused')).toBe(true);
  await page.getByRole('button', { name: '次の和音', exact: true }).click();
  expect(await audioValue(page, 'currentTime')).toBeGreaterThan(1);
  await expect(page.getByTestId('listen-chord')).toContainText('F♯');
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '音声を保存（WAV）', exact: true })
    .click();
  const file = await (await download).path();
  const fd = openSync(file!, 'r');
  const header = Buffer.alloc(44);
  readSync(fd, header, 0, 44, 0);
  const samples = Buffer.alloc(22050 * 2 * 8);
  readSync(fd, samples, 0, samples.length, 44);
  let energy = 0;
  for (let i = 0; i < samples.length; i += 2)
    energy += (samples.readInt16LE(i) / 32768) ** 2;
  expect(Math.sqrt(energy / (samples.length / 2))).toBeGreaterThan(0.01);
  const size = statSync(file!).size;
  const tail = Buffer.alloc(500);
  readSync(fd, tail, 0, 500, size - 500);
  closeSync(fd);
  expect(header.toString('ascii', 0, 4)).toBe('RIFF');
  expect(header.readUInt32LE(40)).toBe(1200 * 22050 * 2);
  expect(tail.toString()).toContain('CC BY 3.0');
  expect(tail.toString()).toContain('Alexander Holm');
  expect(tail.toString()).toContain('VOICEVOX Nemo');
  expect(tail.toString()).not.toContain('HTS Voice Mei');
  await page.getByRole('button', { name: '■ 停止', exact: true }).click();
  expect(await audioValue(page, 'currentTime')).toBe(0);
  expect(await audioValue(page, 'paused')).toBe(true);

  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'ホーム', exact: true })
    .click();
  await expect(page.locator('audio')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('key mode has a tonic reference and sound-first reveal; random mode keeps settings and regenerates', async ({
  page,
}) => {
  test.setTimeout(120000);
  await openListen(page);
  await page.getByRole('button', { name: '調の感覚', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'セットの長さ', exact: true })
    .selectOption('5');
  await page
    .getByRole('combobox', { name: '和音の長さ', exact: true })
    .selectOption('2');
  await page
    .getByRole('combobox', { name: '間隔', exact: true })
    .selectOption('0.5');
  await page
    .getByRole('combobox', { name: '名前と音の順序', exact: true })
    .selectOption('soundFirst');
  await prepare(page);
  await expect(page.locator('.listen-now')).toContainText('主和音の確認');
  await page.getByRole('button', { name: '次の和音', exact: true }).click();
  await expect(page.getByTestId('listen-chord')).toHaveText(
    'まず響きを聴いてください',
  );
  await page.locator('audio').evaluate((e) => {
    (e as HTMLAudioElement).currentTime += 3;
  });
  await expect(page.getByTestId('listen-chord')).not.toHaveText(
    'まず響きを聴いてください',
  );
  await page.getByRole('button', { name: '完全ランダム', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '再生', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('転回形も含める', { exact: true }).check();
  await page.getByLabel('m7♭5', { exact: true }).check();
  await prepare(page);
  const firstSeed = await page.evaluate(
    () => JSON.parse(localStorage.getItem('chordscape.listen.v1')!).seed,
  );
  await page
    .getByRole('button', { name: '新しい並びで作り直す', exact: true })
    .click();
  await expect(
    page.getByText('準備できました。「再生」で開始します。', { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('chordscape.listen.v1')!).seed,
    ),
  ).not.toBe(firstSeed);
  await page.reload();
  await expect(
    page.getByRole('button', { name: '完全ランダム', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByLabel('転回形も含める', { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('button', { name: '再生', exact: true }),
  ).toBeDisabled();
});
test('ambient loads no speech, loops the native file, ends with repeat off, and fits narrow screens', async ({
  page,
}) => {
  test.setTimeout(120000);
  const speechRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/speech/ja/')) speechRequests.push(r.url());
  });
  await openListen(page);
  await page.getByRole('button', { name: '調内・音だけ', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'セットの長さ', exact: true })
    .selectOption('5');
  await prepare(page);
  expect(speechRequests).toEqual([]);
  await page.locator('audio').evaluate((e) => {
    (e as HTMLAudioElement).currentTime = 299.7;
  });
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect.poll(() => audioValue(page, 'currentTime')).toBeLessThan(3);
  await page.getByLabel('セットを繰り返す', { exact: true }).uncheck();
  await page.locator('audio').evaluate((e) => {
    (e as HTMLAudioElement).currentTime = 299.8;
  });
  await expect.poll(() => audioValue(page, 'ended')).toBe(true);
  await expect(
    page.getByText('セットが終了しました', { exact: true }),
  ).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 812 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
test('cancel, missing speech, and leaving preparation never start delayed playback', async ({
  page,
}) => {
  test.setTimeout(120000);
  await openListen(page);
  await page.route('**/samples/salamander/*.mp3', async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.continue().catch(() => {});
  });
  await page.getByRole('button', { name: 'セットを作る', exact: true }).click();
  await page.getByRole('button', { name: '作成を中止', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '再生', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('audio')).not.toHaveAttribute('src', /blob:/);
  await page.unroute('**/samples/salamander/*.mp3');
  await page.route('**/speech/ja/*.mp3', (r) =>
    r.fulfill({ status: 503, body: 'missing' }),
  );
  await page.getByRole('button', { name: 'セットを作る', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('作成・再生できません');
  await expect(
    page.getByRole('button', { name: '再生', exact: true }),
  ).toBeDisabled();
  await page.unroute('**/speech/ja/*.mp3');
  await page.getByRole('button', { name: 'セットを作る', exact: true }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'ホーム', exact: true })
    .click();
  await expect(page.locator('audio')).toHaveCount(0);
  await page.waitForTimeout(700);
  await expect(
    page.getByText('準備できました。「再生」で開始します。', { exact: true }),
  ).toHaveCount(0);
});
