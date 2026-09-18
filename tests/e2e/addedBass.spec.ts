import { test, expect, type Page } from '@playwright/test';
import {
  newSession,
  makeEvent,
  editSession,
  type Session,
} from '../../src/state/session';
import { parsePitch } from '../../src/music/harmony';

const saved = (page: Page): Promise<Session | null> =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem('chordscape.session.v5') ?? 'null'),
  );
const stop = (page: Page) =>
  page.getByRole('button', { name: '■ 停止', exact: true }).click();
const active = (page: Page) =>
  page
    .locator('.piano-key[data-active="true"]')
    .evaluateAll((keys) =>
      keys.map((key) => Number(key.getAttribute('data-midi'))),
    );
const sounding = async (page: Page) =>
  expect
    .poll(() =>
      page.getByTestId('audio-level').getAttribute('value').then(Number),
    )
    .toBeGreaterThan(0.001);
const silent = async (page: Page) =>
  expect
    .poll(() =>
      page.getByTestId('audio-level').getAttribute('value').then(Number),
    )
    .toBeLessThan(0.0001);

test('independent bass editing preserves upper notes through inversion, undo, transpose, JSON and reload', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (info.project.name === 'mobile')
    await page.setViewportSize({ width: 320, height: 812 });
  await page.goto('./');
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('D');
  await page.getByRole('button', { name: 'D I', exact: true }).click();
  await expect(page.locator('.timeline .event')).toHaveCount(1);
  await stop(page);
  const editor = page.locator('.event-editor');
  const bass = editor.getByRole('combobox', { name: 'ベース音', exact: true });
  await bass.selectOption('E');
  await expect(page.getByTestId('chord-symbol')).toHaveText('D/E');
  await expect.poll(() => active(page)).toEqual([40, 50, 54, 57]);
  await sounding(page);
  await expect(page.locator('.chord-summary .badge')).toHaveText('ベース指定');
  await expect(page.locator('.timeline .event')).toContainText('D/E');
  await expect
    .poll(async () => (await saved(page))?.events[0]?.notes)
    .toEqual([40, 50, 54, 57]);
  await editor
    .getByRole('combobox', { name: '上の和音の配置', exact: true })
    .selectOption('1');
  await expect.poll(() => active(page)).toEqual([40, 54, 57, 62]);
  await editor.getByRole('button', { name: '−1 oct', exact: true }).click();
  await expect.poll(() => active(page)).toEqual([28, 42, 45, 50]);
  await expect(page.getByTestId('actual-bass')).toHaveText('E1');
  await stop(page);
  await bass.selectOption('G');
  await expect(page.getByTestId('chord-symbol')).toHaveText('D/G');
  await bass.selectOption('');
  await expect(page.getByTestId('chord-symbol')).toHaveText('D/F♯');
  await expect
    .poll(async () => (await saved(page))?.events[0]?.notes)
    .toEqual([42, 45, 50]);
  await stop(page);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(bass).toHaveValue('G');
  // Both editing surfaces act on the same event.
  await page
    .locator('.detail-section')
    .getByRole('combobox', { name: 'ベース音', exact: true })
    .selectOption('G♭');
  await expect(page.getByTestId('chord-symbol')).toHaveText('D/G♭');
  await stop(page);
  await expect
    .poll(async () => (await saved(page))?.events[0]?.addedBass)
    .toEqual(parsePitch('G♭'));
  await page.reload();
  await page.locator('.timeline .event').click();
  await expect(page.getByTestId('chord-symbol')).toHaveText('D/G♭');
  await stop(page);
  for (const button of ['A: Rootを聴く', 'B: Smoothを聴く', '再生']) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.getByTestId('chord-symbol')).toHaveText('D/G♭');
    await sounding(page);
    await stop(page);
    await silent(page);
  }
  await expect(bass).toHaveValue('G♭');
  await page
    .getByRole('button', { name: '進行全体を移調', exact: true })
    .click();
  await expect(page.locator('.timeline .event')).toContainText('E/A♭');
  await expect
    .poll(async () => (await saved(page))?.events[0]?.addedBass)
    .toEqual(parsePitch('A♭'));
  const expected = (await saved(page))!.events;
  await page
    .locator('.app-header')
    .getByRole('button', { name: '設定', exact: true })
    .click();
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを書き出す' }).click();
  const download = await downloadReady;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'ホーム', exact: true })
    .click();
  await page.getByRole('button', { name: '全消去', exact: true }).click();
  await page
    .locator('.app-header')
    .getByRole('button', { name: '設定', exact: true })
    .click();
  await page
    .getByLabel('セッションJSON')
    .setInputFiles({ name: 'bass.json', mimeType: 'application/json', buffer });
  await expect.poll(async () => (await saved(page))?.events).toEqual(expected);
  await page.locator('.timeline .event').click();
  await stop(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('added-bass-editor.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('eight-note slash chords play with melody and repeated bass changes stop cleanly', async ({
  page,
}) => {
  let session = newSession();
  session = editSession(session, {
    type: 'append',
    event: makeEvent(
      { root: parsePitch('C'), quality: '13' },
      session,
      'eight',
    ),
  });
  session = editSession(session, {
    type: 'event',
    id: 'eight',
    patch: { addedBass: parsePitch('D♭') },
  });
  session = editSession(session, { type: 'regenerateMelody' });
  await page.addInitScript(
    (data) =>
      localStorage.setItem('chordscape.session.v5', JSON.stringify(data)),
    session,
  );
  await page.goto('./');
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(page.getByTestId('chord-symbol')).toHaveText('C13/D♭');
  await expect(page.locator('.piano-key[data-active="true"]')).toHaveCount(8);
  await expect(page.locator('.piano-key[data-melody="true"]')).toHaveCount(1);
  await sounding(page);
  await stop(page);
  await silent(page);
  await page.locator('.timeline .event').click();
  const bass = page
    .locator('.event-editor')
    .getByRole('combobox', { name: 'ベース音', exact: true });
  for (const value of ['E', 'F', 'G', 'A', 'B', 'D♭'])
    await bass.selectOption(value);
  await expect
    .poll(async () => (await saved(page))?.events[0]?.notes.length)
    .toBe(8);
  await expect
    .poll(async () => (await saved(page))?.events[0]?.addedBass)
    .toEqual(parsePitch('D♭'));
  await stop(page);
  await silent(page);
  await page.waitForTimeout(1100);
  await silent(page);
  await expect(page.locator('.piano-key[data-active="true"]')).toHaveCount(0);
});
