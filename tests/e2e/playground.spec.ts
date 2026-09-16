import { test, expect, type Page } from '@playwright/test';
async function enable(page: Page) {
  await page.getByRole('button', { name: '音声を開始', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '音声オン', exact: true }),
  ).toBeVisible();
}
async function stop(page: Page) {
  await page.getByRole('button', { name: '■ 停止', exact: true }).click();
}
async function chord(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
}
async function sounding(page: Page) {
  await expect
    .poll(async () =>
      Number(await page.getByTestId('audio-level').getAttribute('value')),
    )
    .toBeGreaterThan(0.001);
}
async function silent(page: Page) {
  await expect
    .poll(async () =>
      Number(await page.getByTestId('audio-level').getAttribute('value')),
    )
    .toBeLessThan(0.0001);
}
test.beforeEach(async ({ page }) => {
  await page.goto('./');
});
test('production assets, real Web Audio, rapid switching, stop, keyboard and mobile layout', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (/\.(js|css)(\?|$)/.test(r.url()) && r.status() >= 400)
      errors.push(r.url());
  });
  page.on('requestfailed', (r) => errors.push(r.url()));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Chordscape' })).toBeVisible();
  const start = page.getByRole('button', { name: '音声を開始' });
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '音声オン' })).toBeVisible();
  await chord(page, 'Bdim vii°');
  await sounding(page);
  await expect(page.getByTestId('chord-symbol')).toHaveText('Bdim');
  await expect(page.locator('[data-midi="59"]')).toHaveAttribute(
    'data-active',
    'true',
  );
  await chord(page, 'C I');
  await chord(page, 'Dm ii');
  await expect(page.getByTestId('chord-symbol')).toHaveText('Dm');
  await stop(page);
  await expect(page.locator('[data-active="true"]')).toHaveCount(0);
  await silent(page);
  await page.waitForTimeout(1200);
  await silent(page);
  await page.getByLabel('言語').selectOption('en');
  await expect(
    page.getByRole('button', { name: '■ Stop', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/playground-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test('spelled keys, natural minor, outside dominant and seventh inversion share actual bass', async ({
  page,
}) => {
  await enable(page);
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('F');
  await expect(
    page.getByRole('button', { name: 'B♭ IV', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('F♯');
  await chord(page, 'F♯ I');
  await expect(page.getByText('F♯ – A♯ – C♯', { exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: '和音の種類', exact: true })
    .selectOption('7');
  await chord(page, 'F♯maj7 Imaj7');
  await expect(
    page.getByText('F♯ – A♯ – C♯ – E♯', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: '音階', exact: true })
    .selectOption('minor');
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('A');
  await page
    .getByRole('combobox', { name: '和音の種類', exact: true })
    .selectOption('3');
  await expect(
    page.getByRole('button', { name: 'Em v', exact: true }),
  ).toBeVisible();
  await page.getByText('調外の和音', { exact: true }).click();
  await chord(page, 'E7 V7');
  await expect(page.getByText(/短調の第7音を上げて/)).toBeVisible();
  await page
    .getByRole('combobox', { name: '音階', exact: true })
    .selectOption('major');
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('C');
  await page
    .getByRole('combobox', { name: '和音の種類', exact: true })
    .selectOption('7');
  await chord(page, 'G7 V7');
  await page
    .getByLabel('和音の構成: 転回・bass指定', { exact: true })
    .selectOption('3');
  await expect(page.getByTestId('chord-symbol')).toHaveText('G7/F');
  await expect(page.getByTestId('actual-bass')).toHaveText('F3');
  await expect(page.locator('.chord-summary')).toContainText('V4/2');
  await expect(page.locator('[data-midi="53"]')).toHaveAttribute(
    'data-active',
    'true',
  );
  await page
    .getByRole('combobox', { name: '配置', exact: true })
    .selectOption('smooth');
  await stop(page);
  await expect(page.getByTestId('chord-symbol')).toHaveText('G7/F');
});
test('record, event editing, undo/redo, key preservation and local reload', async ({
  page,
}) => {
  await enable(page);
  await chord(page, 'C I');
  await chord(page, 'G V');
  await stop(page);
  await expect(page.locator('.timeline li')).toHaveCount(2);
  await page.getByRole('button', { name: '複製', exact: true }).click();
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await page.getByRole('button', { name: '← 前へ', exact: true }).click();
  await expect(page.locator('.timeline .event').first()).toContainText('G');
  await page
    .getByRole('spinbutton', { name: '長さ（拍）', exact: true })
    .fill('2');
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.locator('.timeline li')).toHaveCount(2);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await page.getByRole('button', { name: '全消去', exact: true }).click();
  await expect(page.locator('.timeline li')).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(page.locator('.timeline li')).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.getByLabel('記録', { exact: true }).uncheck();
  await chord(page, 'Am vi');
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('D');
  await expect(page.locator('.timeline .event').first()).toContainText('G');
  await expect(
    page.getByText('このブラウザに保存済み', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await expect(
    page.getByRole('combobox', { name: '調', exact: true }),
  ).toHaveValue('D');
  await expect(page.getByLabel('記録', { exact: true })).not.toBeChecked();
});
test('library auditions do not record, validated JSON round trip and transpose', async ({
  page,
}) => {
  await enable(page);
  await page.getByText('コード辞典', { exact: true }).click();
  const library = page
    .locator('section')
    .filter({ has: page.locator('summary').filter({ hasText: 'コード辞典' }) });
  await library
    .getByRole('combobox', { name: '根音', exact: true })
    .selectOption('D');
  await library
    .getByRole('combobox', { name: '種類', exact: true })
    .selectOption('7');
  await library.getByRole('button', { name: '試聴', exact: true }).click();
  await expect(page.locator('.timeline li')).toHaveCount(0);
  await expect(page.getByTestId('chord-symbol')).toHaveText('D7');
  await library
    .getByRole('button', { name: '進行へ追加', exact: true })
    .click();
  await expect(page.locator('.timeline li')).toHaveCount(1);
  await stop(page);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを書き出す' }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  await page.getByRole('button', { name: '全消去', exact: true }).click();
  await page.getByLabel('セッションJSON').setInputFiles({
    name: 'session.json',
    mimeType: 'application/json',
    buffer,
  });
  await expect(page.locator('.timeline li')).toHaveCount(1);
  await page.getByLabel('セッションJSON').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":99}'),
  });
  await expect(page.getByRole('alert')).toContainText('読み込めません');
  await expect(page.locator('.timeline li')).toHaveCount(1);
  await page.getByText('進行全体を移調', { exact: true }).first().click();
  await page
    .getByRole('button', { name: '進行全体を移調', exact: true })
    .click();
  await expect(page.locator('.timeline .event')).toContainText('E7');
});
test('loop playback, pause/resume, edits, tempo and comparison stop cleanly', async ({
  page,
}) => {
  await enable(page);
  await page
    .getByRole('combobox', { name: '長さ（拍）', exact: true })
    .selectOption('1');
  await chord(page, 'C I');
  await chord(page, 'G V');
  await chord(page, 'Am vi');
  await chord(page, 'F IV');
  await stop(page);
  await page.getByLabel('ループ', { exact: true }).check();
  await page.getByLabel('BPM', { exact: true }).fill('200');
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await sounding(page);
  await expect(
    page.getByRole('button', { name: 'C I', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await silent(page);
  await expect(
    page.getByRole('button', { name: '再開', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await sounding(page);
  await page
    .getByRole('spinbutton', { name: '長さ（拍）', exact: true })
    .fill('2');
  await page.getByLabel('BPM', { exact: true }).fill('150');
  await page
    .getByRole('button', { name: 'B: Smoothを聴く', exact: true })
    .click();
  await sounding(page);
  await page.waitForTimeout(1800);
  await stop(page);
  await silent(page);
  await expect(page.locator('[data-active="true"]')).toHaveCount(0);
});
test('storage refusal leaves audition and export usable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Denied', 'SecurityError');
    };
  });
  await page.reload();
  await enable(page);
  await chord(page, 'C I');
  await sounding(page);
  await expect(page.getByText(/ブラウザ保存を利用できません/)).toBeVisible();
  await stop(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを書き出す' }).click();
  expect((await download).suggestedFilename()).toBe('chordscape-session.json');
});
test('suspended AudioContext pauses transport and resumes only after user action', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        (
          window as typeof window & { testAudioContext?: AudioContext }
        ).testAudioContext = this;
      }
    };
  });
  await page.reload();
  await enable(page);
  await chord(page, 'C I');
  await stop(page);
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await sounding(page);
  await page.evaluate(async () => {
    await (
      window as typeof window & { testAudioContext: AudioContext }
    ).testAudioContext.suspend();
  });
  await expect(
    page.getByRole('button', { name: '音声を開始', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '再開', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('[data-active="true"]')).toHaveCount(0);
  await enable(page);
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await sounding(page);
  await stop(page);
  await silent(page);
});
test('editing a paused progression cannot resume a deleted snapshot', async ({
  page,
}) => {
  await enable(page);
  await chord(page, 'C I');
  await stop(page);
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await sounding(page);
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await page.getByRole('button', { name: '全消去', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '再開', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '再生', exact: true }),
  ).toBeDisabled();
  await silent(page);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '再生', exact: true }),
  ).toBeEnabled();
});
