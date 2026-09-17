import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { Session } from '../../src/state/session';
import { chooseVoicing } from '../../src/music/voicing';
async function enable(page: Page) {
  await page.getByRole('button', { name: '音声を開始', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '音声オン', exact: true }),
  ).toBeVisible();
}
async function melody(page: Page) {
  await page.getByRole('button', { name: '旋律', exact: true }).click();
}
async function saved(page: Page): Promise<Session> {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('chordscape.session.v4') ?? 'null'),
  );
}
async function stop(page: Page) {
  await page.getByRole('button', { name: '■ 停止', exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.getByTestId('audio-level').getAttribute('value')),
    )
    .toBeLessThan(0.0001);
  await expect(page.locator('[data-melody="true"]')).toHaveCount(0);
}
test.beforeEach(async ({ page }) => {
  await page.goto('./');
});
test('continuous generation prepares melody with the next phrase and persists the current snapshot', async ({
  page,
}) => {
  await enable(page);
  await page.getByRole('spinbutton', { name: 'BPM', exact: true }).fill('200');
  await melody(page);
  await page
    .getByRole('checkbox', { name: '旋律を鳴らす', exact: true })
    .check();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '進行生成', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: '和音を変える間隔', exact: true })
    .selectOption('2');
  await page
    .getByRole('button', { name: '連続生成を開始', exact: true })
    .click();
  await expect(page.locator('[data-melody="true"]')).toHaveCount(1);
  await expect
    .poll(async () => (await saved(page))?.generation?.phrase, {
      timeout: 10000,
    })
    .toBeGreaterThanOrEqual(1);
  await stop(page);
  const data = await saved(page);
  expect(data.events.every((e) => e.melody?.length)).toBe(true);
  await page.reload();
  await enable(page);
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(page.locator('[data-melody="true"]')).toHaveCount(1);
  await stop(page);
});
test('Timeline saves deterministic melody, regenerates without changing chords, and replays both parts', async ({
  page,
}) => {
  await enable(page);
  for (const name of ['C I', 'G V', 'Am vi', 'F IV'])
    await page.getByRole('button', { name, exact: true }).click();
  await stop(page);
  await melody(page);
  await page
    .getByRole('checkbox', { name: '旋律を鳴らす', exact: true })
    .check();
  await expect(
    page.getByRole('img', { name: 'ピアノロール', exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await saved(page))?.events[0].melody?.length ?? 0)
    .toBeGreaterThan(0);
  const original = await saved(page);
  await page.getByRole('button', { name: '旋律を再生成', exact: true }).click();
  await expect
    .poll(async () => (await saved(page))?.settings.melody.seed)
    .toBe(43);
  const regenerated = await saved(page);
  expect(
    regenerated.events.map((e) => [e.chord, e.notes, e.key, e.duration]),
  ).toEqual(original.events.map((e) => [e.chord, e.notes, e.key, e.duration]));
  expect(regenerated.events.map((e) => e.melody)).not.toEqual(
    original.events.map((e) => e.melody),
  );
  await page
    .getByRole('button', { name: 'Timelineで演奏', exact: true })
    .click();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(page.locator('[data-melody="true"]')).toHaveCount(1);
  await expect(page.getByTestId('melody-current')).toBeVisible();
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await expect(page.locator('[data-melody="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await expect(page.locator('[data-melody="true"]')).toHaveCount(1);
  await stop(page);
  await expect
    .poll(async () => (await saved(page))?.events)
    .toEqual(original.events);
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '設定', exact: true })
    .click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'JSONを書き出す', exact: true })
    .click();
  const file = await download;
  await page.getByLabel('セッションJSON').setInputFiles((await file.path())!);
  await expect(page.locator('.timeline .event')).toHaveCount(4);
  expect((await saved(page)).events).toEqual(original.events);
});

test('Next beat Live applies the last pending chord, records applied timing and switches to Timeline exclusively', async ({
  page,
}) => {
  await page
    .getByRole('combobox', { name: '配置', exact: true })
    .selectOption('smooth');
  await page.getByRole('spinbutton', { name: 'BPM', exact: true }).fill('40');
  await enable(page);
  await melody(page);
  await page
    .getByRole('checkbox', { name: '旋律を鳴らす', exact: true })
    .check();
  await page
    .getByRole('combobox', { name: '和音の切替', exact: true })
    .selectOption('nextBeat');
  await page.getByRole('button', { name: 'Liveで演奏', exact: true }).click();
  await page.getByRole('button', { name: 'C I', exact: true }).click();
  await expect(page.locator('[data-melody="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Dm ii', exact: true }).click();
  await page.getByRole('button', { name: 'G V', exact: true }).click();
  await expect(page.getByTestId('live-pending')).toContainText('G');
  await expect(page.getByTestId('chord-symbol')).toHaveText('C');
  await expect(page.getByTestId('chord-symbol')).toHaveText(/^G(?:\/.*)?$/);
  await expect(page.getByTestId('live-pending')).toBeHidden();
  // Play finalizes the active live chord before reading the Timeline snapshot.
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(page.locator('.live-status')).toHaveCount(0);
  await expect(page.getByTestId('chord-symbol')).toHaveText('C');
  await stop(page);
  await expect.poll(async () => (await saved(page))?.events.length).toBe(2);
  const session = await saved(page);
  expect(session.events.map((e) => e.chord.root.letter)).toEqual(['C', 'G']);
  expect(session.events[1].notes).toEqual(
    chooseVoicing(session.events[1], session.events[0].notes),
  );
  expect(session.events[0].duration).toBeCloseTo(1);
  expect(session.events[1].live?.appliedBeat).toBe(1);
  expect(session.events[1].live!.requestedBeat).toBeLessThan(1);
  expect(session.events.every((e) => e.melody!.length > 0)).toBe(true);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.timeline .event')).toHaveCount(0);
});

test('Immediate Live follows new chord tones, stops both parts, and supports melody off', async ({
  page,
}) => {
  await enable(page);
  await melody(page);
  await page
    .getByRole('checkbox', { name: '旋律を鳴らす', exact: true })
    .check();
  await page.getByRole('button', { name: 'Liveで演奏', exact: true }).click();
  await page.getByRole('button', { name: 'C I', exact: true }).click();
  await expect(page.locator('[data-melody="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Am vi', exact: true }).click();
  await expect(page.getByTestId('chord-symbol')).toHaveText('Am');
  const midi = Number(
    await page.locator('[data-melody="true"]').getAttribute('data-midi'),
  );
  expect([9, 0, 4]).toContain(midi % 12);
  await stop(page);
  await expect.poll(async () => (await saved(page))?.events.length).toBe(2);
  const session = await saved(page);
  expect(session.events[0].duration).toBeLessThan(1);
  expect(session.events[0].duration).toBeGreaterThan(0);
  await melody(page);
  await page
    .getByRole('checkbox', { name: '旋律を鳴らす', exact: true })
    .uncheck();
  await page
    .getByRole('button', { name: 'Timelineで演奏', exact: true })
    .click();
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(page.locator('[data-melody="true"]')).toHaveCount(0);
  await stop(page);
});

test('melody controls fit mobile and harmonic edits rebuild the saved line while retaining range', async ({
  page,
}) => {
  await enable(page);
  await page.getByRole('button', { name: 'C I', exact: true }).click();
  await stop(page);
  await melody(page);
  await page
    .getByRole('checkbox', { name: '旋律を鳴らす', exact: true })
    .check();
  await page
    .getByRole('spinbutton', { name: '最低音（MIDI）', exact: true })
    .fill('72');
  await page.getByRole('slider', { name: /音の密度/ }).press('End');
  await page.setViewportSize({ width: 320, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page
    .getByRole('button', { name: 'Timelineで演奏', exact: true })
    .click();
  await page.getByRole('button', { name: 'F IV', exact: true }).click();
  await stop(page);
  await expect.poll(async () => (await saved(page))?.events.length).toBe(2);
  const data = await saved(page);
  for (const event of data.events)
    for (const note of event.melody!)
      if (note.midi !== null) expect(note.midi).toBeGreaterThanOrEqual(72);
  await page.locator('.timeline .event').last().click();
  await expect(
    page.getByRole('img', { name: 'ピアノロール', exact: true }),
  ).toBeVisible();
});

test('future voice cancellation can be superseded by an earlier Stop without leaking old melody', async ({
  page,
}) => {
  const code = ts.transpileModule(readFileSync('src/audio/voices.ts', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const result = await page.evaluate(async (code) => {
    const url = URL.createObjectURL(
      new Blob([code], { type: 'text/javascript' }),
    );
    const { createNoteVoice } = (await import(
      /* @vite-ignore */ url
    )) as typeof import('../../src/audio/voices');
    URL.revokeObjectURL(url);
    const context = new OfflineAudioContext(1, 48000, 48000);
    const voice = createNoteVoice(
      context,
      context.destination,
      'soft',
      72,
      0.3,
      0.6,
      new Map(),
    );
    voice.stop(0.5);
    voice.stop(0.2); // A queued boundary, then Stop before onset.
    const data = (await context.startRendering()).getChannelData(0);
    return data.reduce((max, n) => Math.max(max, Math.abs(n)), 0);
  }, code);
  expect(result).toBe(0);
});
