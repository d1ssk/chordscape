import { test, expect, type Page } from '@playwright/test';
import type { Session } from '../../src/state/session';

async function nav(page: Page, name: string) {
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
async function saved(page: Page): Promise<Session> {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('chordscape.session.v4') ?? 'null'),
  );
}
async function propose(page: Page, key = 'G メジャー') {
  await nav(page, '五度圏');
  await page.getByRole('button', { name: key, exact: true }).click();
  await page.getByRole('button', { name: '転調して進む', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('circle compares without editing; keyboard, relative minor, enharmonic spellings and mobile width work', async ({
  page,
}) => {
  await nav(page, '五度圏');
  await expect(page.getByTestId('common-chords')).toHaveText('C · Em · G · Am');
  await page.getByRole('button', { name: 'D メジャー', exact: true }).click();
  await expect(page.getByTestId('circle-current')).toHaveText('C メジャー');
  await page
    .getByRole('button', { name: 'D メジャー', exact: true })
    .press('ArrowDown');
  await expect(
    page.getByRole('button', { name: 'B 自然短音階', exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'B 自然短音階', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'この調を選ぶ', exact: true }).click();
  await expect(page.getByTestId('circle-current')).toHaveText('B 自然短音階');
  await page
    .getByRole('combobox', { name: '異名同音の表示' })
    .selectOption('flat');
  await expect(
    page.getByRole('button', { name: 'G♭ メジャー', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'E♭ 自然短音階', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 812 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await expect(
    page.getByRole('button', { name: 'F メジャー', exact: true }),
  ).toBeInViewport();
  await nav(page, '演奏');
  await expect(page.locator('.timeline .event')).toHaveCount(0);
  await expect(
    page.getByRole('combobox', { name: '調', exact: true }),
  ).toHaveValue('B');
  await expect(
    page.getByRole('combobox', { name: '音階', exact: true }),
  ).toHaveValue('minor');
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: '五度圏', exact: true }),
  ).toBeFocused();
});

test('bridge appends with dual analysis and the audible tonic switches the palette at its saved beat', async ({
  page,
}) => {
  await page
    .getByRole('combobox', { name: '長さ（拍）', exact: true })
    .selectOption('1');
  await page.getByRole('spinbutton', { name: 'BPM', exact: true }).fill('120');
  await enable(page);
  await propose(page);
  await expect(page.locator('.bridge-list > li').nth(1)).toContainText('vi');
  await expect(page.locator('.bridge-list > li').nth(1)).toContainText('ii');
  await expect(page.locator('.bridge-list > li').nth(2)).toContainText('V7/V');
  await expect(page.locator('.bridge-list > li').nth(3)).toContainText(
    '調の切替',
  );
  await page.getByRole('button', { name: '進行に追加', exact: true }).click();
  await expect(page.locator('.timeline .event strong')).toHaveText([
    'C',
    'Am',
    'D7',
    'G',
  ]);
  await expect
    .poll(async () => (await saved(page))?.keyEvents)
    .toEqual([
      {
        eventId: expect.any(String),
        beat: 0,
        key: { tonic: { letter: 'C', accidental: 0 }, mode: 'major' },
        intent: 'initial',
      },
      {
        eventId: expect.any(String),
        beat: 3,
        key: { tonic: { letter: 'G', accidental: 0 }, mode: 'major' },
        intent: 'pivot',
      },
    ]);
  await expect(
    page.getByRole('combobox', { name: '調', exact: true }),
  ).toHaveValue('C');
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(page.getByTestId('chord-symbol')).toHaveText('D7');
  await expect(
    page.getByRole('combobox', { name: '調', exact: true }),
  ).toHaveValue('C');
  await expect(page.getByTestId('dual-analysis')).toContainText('V7/V');
  await expect(page.getByTestId('chord-symbol')).toHaveText('G');
  await expect(
    page.getByRole('combobox', { name: '調', exact: true }),
  ).toHaveValue('G');
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: '調', exact: true }),
  ).toHaveValue('G');
  await page.getByRole('spinbutton', { name: 'BPM', exact: true }).fill('90');
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await expect(page.getByTestId('chord-symbol')).toHaveText('G');
  await page.getByRole('button', { name: '■ 停止', exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.getByTestId('audio-level').getAttribute('value')),
    )
    .toBeLessThan(0.0001);
  await expect(
    page.getByRole('combobox', { name: '調', exact: true }),
  ).toHaveValue('G');
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(page.getByTestId('chord-symbol')).toHaveText('C');
  await expect(
    page.getByRole('combobox', { name: '調', exact: true }),
  ).toHaveValue('C');
  await page.getByRole('button', { name: '■ 停止', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: '調', exact: true }),
  ).toHaveValue('C');
});

test('audition uses the shared clock without saving the proposed key or chords', async ({
  page,
}) => {
  await page
    .getByRole('combobox', { name: '長さ（拍）', exact: true })
    .selectOption('0.5');
  await page.getByRole('spinbutton', { name: 'BPM', exact: true }).fill('120');
  await enable(page);
  await propose(page);
  await page.getByTestId('circle-current').evaluate((node) => {
    const keys = [node.textContent];
    document.documentElement.dataset.keyTrace = JSON.stringify(keys);
    new MutationObserver(() => {
      keys.push(node.textContent);
      document.documentElement.dataset.keyTrace = JSON.stringify(keys);
    }).observe(node, { childList: true, characterData: true, subtree: true });
  });
  await page
    .getByRole('button', { name: 'ブリッジを試聴', exact: true })
    .click();
  await expect(
    page.getByText('ブリッジ試聴中（進行への追加・調の保存は行いません）'),
  ).toBeVisible();
  await expect(
    page.getByText('ブリッジ試聴中（進行への追加・調の保存は行いません）'),
  ).toBeHidden();
  // Record transitions in the browser, so a short tonic cannot fall between
  // Playwright's polling intervals.
  expect(
    await page.evaluate(() =>
      JSON.parse(document.documentElement.dataset.keyTrace!),
    ),
  ).toEqual(['C メジャー', 'G メジャー', 'C メジャー']);
  await expect(
    page.getByRole('button', { name: 'ブリッジを試聴', exact: true }),
  ).toBeEnabled();
  expect((await saved(page)).events).toEqual([]);
  expect((await saved(page)).settings.key.tonic.letter).toBe('C');
  await page.getByRole('button', { name: '進行に追加', exact: true }).click();
  await expect(page.locator('.timeline .event')).toHaveCount(4);
});

test('circle travel persists ordinary timeline key events and transposes all old/new contexts with undo', async ({
  page,
}) => {
  await enable(page);
  await nav(page, '五度圏');
  await page
    .getByRole('button', { name: '連続巡回を開始', exact: true })
    .click();
  await expect(page.locator('.timeline .event')).toHaveCount(37);
  await page.getByRole('button', { name: '■ 停止', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.keyEvents.length).toBe(13);
  const original = await saved(page);
  expect(original.keyEvents.slice(0, 4).map((k) => k.key.tonic.letter)).toEqual(
    ['C', 'G', 'D', 'A'],
  );
  expect(original.settings.loop).toBe(true);
  await page
    .getByRole('button', { name: '進行全体を移調', exact: true })
    .click();
  await expect
    .poll(async () => (await saved(page))?.keyEvents[0].key.tonic.letter)
    .toBe('D');
  const moved = await saved(page);
  expect(moved.keyEvents.map((k) => k.beat)).toEqual(
    original.keyEvents.map((k) => k.beat),
  );
  expect(moved.events[1].modulation?.from.tonic.letter).toBe('D');
  expect(moved.events[1].modulation?.to.tonic.letter).toBe('A');
  await page.reload();
  await expect(page.locator('.timeline .event')).toHaveCount(37);
  await nav(page, '設定');
  await page.getByLabel('セッションJSON').setInputFiles({
    name: 'travel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(original)),
  });
  await expect(page.locator('.timeline .event').first()).toContainText('C');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.timeline .event').first()).toContainText('D');
});

test('direct modulation, destination cadence and seventh comparison are explicit', async ({
  page,
}) => {
  await propose(page, 'F♯ メジャー');
  await expect(page.locator('.bridge-proposal')).toContainText('直接転調');
  await expect(page.locator('.bridge-list > li')).toHaveCount(3);
  await page.getByRole('checkbox', { name: '新調での終止を続ける' }).check();
  await expect(page.locator('.bridge-list > li')).toHaveCount(6);
  await page.getByRole('button', { name: '進行に追加', exact: true }).click();
  await expect(page.locator('.timeline .event strong')).toHaveText([
    'C',
    'C♯7',
    'F♯',
    'B',
    'C♯7',
    'F♯',
  ]);
  await nav(page, '五度圏');
  await page
    .getByRole('combobox', { name: '和音の種類', exact: true })
    .selectOption('7');
  await expect(page.getByTestId('common-chords')).toHaveText(
    'Cmaj7 · Em7 · Am7',
  );
  await page.getByRole('button', { name: 'この調を選ぶ', exact: true }).click();
  await nav(page, '演奏');
  await expect(page.locator('.timeline .event strong')).toHaveText([
    'C',
    'C♯7',
    'F♯',
    'B',
    'C♯7',
    'F♯',
  ]);
});
