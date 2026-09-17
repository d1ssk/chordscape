import { test, expect, type Page } from '@playwright/test';
import type { Session } from '../../src/state/session';

async function navigate(page: Page, name: string) {
  await (
    name === '設定' ? page.locator('.app-header') : page.getByRole('navigation')
  )
    .getByRole('button', { name, exact: true })
    .click();
}
async function enable(page: Page) {
  await page.getByRole('button', { name: /^(音声を開始|音声オン)$/ }).click();
  await expect(
    page.getByRole('button', { name: '音声オン', exact: true }),
  ).toBeVisible();
}
async function stop(page: Page) {
  await page.getByRole('button', { name: '■ 停止', exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.getByTestId('audio-level').getAttribute('value')),
    )
    .toBeLessThan(0.0001);
}
async function saved(page: Page): Promise<Session> {
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('chordscape.session.v4')),
    )
    .not.toBeNull();
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('chordscape.session.v4')!),
  );
}
async function jazz(page: Page) {
  await navigate(page, '進行生成');
  await page
    .getByRole('combobox', { name: 'スタイル', exact: true })
    .selectOption('jazz');
  await page.getByRole('slider', { name: /調外和音を使う確率/ }).press('End');
  await page.getByLabel('Seed', { exact: true }).fill('42');
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  await expect(page.locator('.timeline .event strong')).toHaveText([
    'CM7',
    'A7',
    'Dm7',
    'G7',
  ]);
}
test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('Jazz generates editable, reproducible notes and distinguishes intent from current resolution', async ({
  page,
}) => {
  await jazz(page); // Generation itself does not require or start audio.
  await expect(
    page.getByRole('button', { name: '音声を開始', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.timeline .event > span')).toHaveText([
    'IM7',
    'V7/ii',
    'ii7',
    'V7',
  ]);
  await expect.poll(async () => (await saved(page)).events.length).toBe(4);
  const original = await saved(page);
  await page.locator('.timeline .event').nth(1).click();
  await page.locator('.theory-details summary').click();
  await expect(page.getByTestId('generation-intent')).toContainText('V7/ii');
  await expect(page.locator('.explanation')).toContainText('Dm7');
  await expect(page.locator('.explanation')).toContainText('解決として解釈');
  await page.locator('.timeline .event').nth(2).click();
  await page.locator('.editor-disclosure summary').click();
  await page.getByRole('button', { name: '後へ →', exact: true }).click();
  await page.locator('.timeline .event').nth(1).click();
  await expect(page.locator('.explanation')).toContainText('解決は前後関係');
  await expect(page.getByTestId('generation-intent')).toContainText(
    '生成時の意図',
  );
  await navigate(page, '進行生成');
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).events)
    .toEqual(original.events);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.timeline .event strong')).toHaveText([
    'CM7',
    'A7',
    'G7',
    'Dm7',
  ]);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(page.locator('.timeline .event strong')).toHaveText([
    'CM7',
    'A7',
    'Dm7',
    'G7',
  ]);
  await enable(page);
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(
    page.locator('.timeline .event[aria-current="step"]'),
  ).toContainText('CM7');
  await expect
    .poll(async () =>
      Number(await page.getByTestId('audio-level').getAttribute('value')),
    )
    .toBeGreaterThan(0.001);
  await stop(page);
});

test('generated JSON, inversion edits and seed survive export, import and reload', async ({
  page,
}) => {
  await jazz(page);
  await page.locator('.timeline .event').nth(3).click();
  await page
    .getByLabel('和音の構成: 転回・bass指定', { exact: true })
    .selectOption('3');
  await expect(page.getByTestId('chord-symbol')).toHaveText('G7/F');
  await navigate(page, '設定');
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'JSONを書き出す', exact: true })
    .click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  const data = JSON.parse(buffer.toString()) as Session;
  expect(data.schemaVersion).toBe(4);
  expect(data.generation?.options.seed).toBe(42);
  expect(data.generation?.modified).toBe(true);
  expect(data.events[1].intent?.appliedTo).toBe(1);
  await navigate(page, '演奏');
  await page.getByRole('button', { name: '全消去', exact: true }).click();
  await navigate(page, '設定');
  await page.getByLabel('セッションJSON').setInputFiles({
    name: 'generated.json',
    mimeType: 'application/json',
    buffer,
  });
  await expect(page.locator('.timeline .event strong')).toHaveText([
    'CM7',
    'A7',
    'Dm7',
    'G7/F',
  ]);
  await expect
    .poll(async () => (await saved(page)).events)
    .toEqual(data.events);
  await page.reload();
  await expect(page.locator('.timeline .event strong')).toHaveText([
    'CM7',
    'A7',
    'Dm7',
    'G7/F',
  ]);
  await navigate(page, '進行生成');
  await expect(page.getByLabel('Seed', { exact: true })).toHaveValue('42');
  await expect(
    page.getByRole('combobox', { name: 'スタイル', exact: true }),
  ).toHaveValue('jazz');
});

test('extended library keeps ninths distinct, with all five sounding notes and member bass', async ({
  page,
}) => {
  await enable(page);
  await navigate(page, 'コード辞典');
  await page.getByRole('button', { name: 'Cadd9', exact: true }).click();
  await expect(page.locator('.library-panel')).toContainText('C – E – G – D');
  await page.getByRole('button', { name: '試聴', exact: true }).click();
  await expect(page.locator('[data-active="true"]')).toHaveCount(4);
  await page.getByRole('button', { name: 'C9', exact: true }).click();
  await page.getByRole('button', { name: '試聴', exact: true }).click();
  await expect(page.locator('.library-panel')).toContainText(
    'C – E – G – B♭ – D',
  );
  await expect(page.locator('[data-active="true"]')).toHaveCount(5);
  await page
    .getByLabel('和音の構成: 転回・bass指定', { exact: true })
    .selectOption('4');
  await expect(page.getByTestId('chord-symbol')).toHaveText('C9/D');
  await expect(page.getByTestId('actual-bass')).toHaveText('D3');
  await expect(page.locator('.chord-summary')).toContainText('第4転回');
  await expect(page.locator('.chord-summary')).not.toContainText('undefined');
  await stop(page);
});

test('continuous generation changes only at phrase boundaries and stops on editing', async ({
  page,
}) => {
  await enable(page);
  await page.getByLabel('BPM', { exact: true }).fill('200');
  await navigate(page, '進行生成');
  await page
    .getByRole('button', { name: '連続生成を開始', exact: true })
    .click();
  await expect(page.locator('.continuous-status')).toContainText('フレーズ 1');
  const first = await page.locator('.timeline .event strong').allTextContents();
  await page.waitForTimeout(1000);
  await expect(page.locator('.timeline .event strong')).toHaveText(first);
  await navigate(page, '進行生成');
  await expect(
    page.getByRole('button', { name: '生成する', exact: true }),
  ).toBeDisabled();
  await navigate(page, '演奏');
  await expect(page.locator('.continuous-status')).toContainText('フレーズ 2', {
    timeout: 6500,
  });
  await expect.poll(async () => (await saved(page)).generation?.phrase).toBe(1);
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  const second = await page
    .locator('.timeline .event strong')
    .allTextContents();
  await page.getByLabel('BPM', { exact: true }).fill('100');
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await expect(page.locator('.continuous-status')).toContainText('フレーズ 2');
  await expect(page.locator('.timeline .event strong')).toHaveText(second);
  await page.locator('.timeline .event').first().click();
  await page.locator('.editor-disclosure summary').click();
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.locator('.continuous-status')).toHaveCount(0);
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await stop(page);
  await page.waitForTimeout(250);
  await expect(page.locator('[data-active="true"]')).toHaveCount(0);
  await expect
    .poll(async () => (await saved(page)).generation?.modified)
    .toBe(true);
});

test('short phrase fallback and mobile generation scene remain usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await navigate(page, '進行生成');
  await page
    .getByRole('combobox', { name: '和音を変える間隔', exact: true })
    .selectOption('8');
  await page.getByRole('slider', { name: /調外和音を使う確率/ }).press('End');
  await page
    .getByRole('combobox', { name: '終わり方', exact: true })
    .selectOption('cadence');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '生成する', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '和音が2つ' }),
  ).toBeVisible();
  await expect(page.locator('.timeline .event strong')).toHaveText(['G', 'C']);
  await expect(page.locator('.diatonic-row .palette button')).toHaveCount(14);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
