import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
async function scene(page: Page, name = '演奏') {
  await page
    .getByRole('navigation')
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
async function expand(page: Page, selector: string) {
  const details = page.locator(selector);
  if (!(await details.evaluate((e) => (e as HTMLDetailsElement).open)))
    await details.locator(':scope > summary').click();
}
test.beforeEach(async ({ page }) => {
  await page.goto('./');
});
test('production assets, audio, stop, keyboard and scene navigation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (/\.(js|css|mp3)(\?|$)/.test(r.url()) && r.status() >= 400)
      errors.push(r.url());
  });
  page.on('requestfailed', (r) => errors.push(r.url()));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Chordscape' })).toBeVisible();
  await expect(page.getByText(/HARMONY PLAYGROUND|和音に触れて/)).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: '音声を開始' }).focus();
  await page.keyboard.press('Enter');
  await chord(page, 'Bdim vii°');
  await sounding(page);
  await expect(page.getByTestId('chord-symbol')).toHaveText('Bdim');
  await expect(page.locator('[data-midi="59"]')).toHaveAttribute(
    'data-active',
    'true',
  );
  await chord(page, 'C I');
  await chord(page, 'Dm ii');
  await stop(page);
  await silent(page);
  await page.waitForTimeout(1100);
  await silent(page);
  await expect(page.locator('[data-active="true"]')).toHaveCount(0);
  await scene(page, 'コード辞典');
  await expect(
    page.getByRole('heading', { name: 'コード辞典', exact: true }),
  ).toBeFocused();
  await expect(page.locator('.palette-panel')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Chordscape' })).toBeVisible();
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await scene(page, '設定');
  await page.getByLabel('言語').selectOption('en');
  await scene(page, 'Play');
  await expect(
    page.getByRole('button', { name: '■ Stop', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/compact-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test('triads and sevenths each fit one mobile row with keyboard and progression visible', async ({
  page,
}) => {
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 812 });
    const boxes = await page
      .locator('.diatonic-row .palette button')
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const b = button.getBoundingClientRect();
          return { top: b.top, left: b.left, right: b.right };
        }),
      );
    expect(boxes).toHaveLength(14);
    expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(2);
    for (const row of [boxes.slice(0, 7), boxes.slice(7)]) {
      expect(new Set(row.map((b) => Math.round(b.top))).size).toBe(1);
      expect(row[6].right).toBeLessThanOrEqual(width);
    }
    expect(boxes[0].left).toBeGreaterThanOrEqual(0);
    expect(boxes[6].right).toBeLessThanOrEqual(width);
    expect(
      await page
        .locator('.key-panel')
        .evaluate((e) => e.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(40);
    const fields = await page
      .locator('.key-panel select')
      .evaluateAll((es) =>
        es.map((e) => Math.round(e.getBoundingClientRect().top)),
      );
    expect(fields).toHaveLength(2);
    expect(new Set(fields).size).toBe(1);
    for (const selector of ['.transport button', '.voicing-controls button']) {
      const buttons = await page.locator(selector).evaluateAll((es) =>
        es.map((e) => ({
          top: e.getBoundingClientRect().top,
          height: e.getBoundingClientRect().height,
        })),
      );
      expect(new Set(buttons.map((b) => b.top)).size).toBe(1);
      expect(Math.max(...buttons.map((b) => b.height))).toBeLessThanOrEqual(30);
    }
    for (const button of await page.locator('.scene-nav button').all()) {
      expect(
        await button.evaluate((e) => {
          const range = document.createRange();
          range.selectNodeContents(e);
          return {
            lines: range.getClientRects().length,
            fits: e.scrollWidth <= e.clientWidth,
          };
        }),
      ).toEqual({ lines: 1, fits: true });
    }
    await expect(
      page.getByRole('button', { name: 'A: Rootを聴く', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '進行全体を移調', exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator('.keyboard')
        .evaluate((e) => e.getBoundingClientRect().bottom),
    ).toBeLessThan(650);
    expect(
      await page
        .locator('.timeline-panel h2')
        .evaluate((e) => e.getBoundingClientRect().bottom),
    ).toBeLessThan(730);
    await expand(page, '.outside');
    const outside = await page
      .locator('.outside .palette button')
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const b = button.getBoundingClientRect();
          return { top: b.top, height: b.height };
        }),
      );
    expect(outside.length).toBeGreaterThanOrEqual(24);
    expect(
      outside.filter((b) => b.top === outside[0].top).length,
    ).toBeGreaterThanOrEqual(6);
    expect(Math.max(...outside.map((b) => b.height))).toBeLessThanOrEqual(48);
    await page.locator('.outside > summary').click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await enable(page);
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('F♯');
  expect(
    await page
      .locator('.diatonic-row .palette button')
      .evaluateAll(
        (items) =>
          new Set(items.map((e) => Math.round(e.getBoundingClientRect().top)))
            .size,
      ),
  ).toBe(2);
});
test('key spellings, minor outside dominant and seventh bass', async ({
  page,
}) => {
  await enable(page);
  await expand(page, '.outside');
  await chord(page, 'A7 V7/ii');
  await sounding(page);
  await expect(page.getByText('A – C♯ – E – G', { exact: true })).toBeVisible();
  await chord(page, 'Fm7 iv7');
  await expect(
    page.getByText('F – A♭ – C – E♭', { exact: true }),
  ).toBeVisible();
  await stop(page);
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('F');
  await expect(
    page.getByRole('button', { name: 'B♭ IV', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('F♯');
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
  await expect(
    page.getByRole('button', { name: 'Em v', exact: true }),
  ).toBeVisible();
  await expand(page, '.outside');
  await chord(page, 'E7 V7');
  await expand(page, '.theory-details');
  await expect(page.getByText(/短調の第7音を上げて/)).toBeVisible();
  await chord(page, 'G♯dim7 vii°7');
  await expect(page.getByText('G♯ – B – D – F', { exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: '音階', exact: true })
    .selectOption('major');
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('C');
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
test('event edits, undo, record off and reload preserve the session', async ({
  page,
}) => {
  await enable(page);
  await chord(page, 'C I');
  await chord(page, 'G V');
  await stop(page);
  await expand(page, '.editor-disclosure');
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
  await page.getByRole('button', { name: '全消去', exact: true }).click();
  await expect(page.locator('.timeline li')).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await page.getByLabel('記録', { exact: true }).uncheck();
  await chord(page, 'Am vi');
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('D');
  await scene(page, '設定');
  await expect(
    page.getByText('このブラウザに保存済み', { exact: true }),
  ).toBeVisible();
  await scene(page);
  await page.reload();
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await expect(
    page.getByRole('combobox', { name: '調', exact: true }),
  ).toHaveValue('D');
  await expect(page.getByLabel('記録', { exact: true })).not.toBeChecked();
});
test('library auditions and adds, JSON round trip, invalid import and transpose', async ({
  page,
}) => {
  await enable(page);
  await scene(page, 'コード辞典');
  const library = page.locator('.library-panel');
  await library
    .getByRole('combobox', { name: '根音', exact: true })
    .selectOption('D');
  await library.getByRole('button', { name: 'D7', exact: true }).click();
  await library.getByRole('button', { name: '試聴', exact: true }).click();
  await expect(page.getByTestId('chord-symbol')).toHaveText('D7');
  await scene(page);
  await expect(page.locator('.timeline li')).toHaveCount(0);
  await scene(page, 'コード辞典');
  await library
    .getByRole('button', { name: '進行へ追加', exact: true })
    .click();
  await expect(page.locator('.timeline li')).toHaveCount(1);
  await stop(page);
  await scene(page, '設定');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを書き出す' }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  await scene(page);
  await page.getByRole('button', { name: '全消去', exact: true }).click();
  await scene(page, '設定');
  await page.getByLabel('セッションJSON').setInputFiles({
    name: 'session.json',
    mimeType: 'application/json',
    buffer,
  });
  await expect(page.locator('.timeline li')).toHaveCount(1);
  await scene(page, '設定');
  await page.getByLabel('セッションJSON').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":99}'),
  });
  await expect(page.getByRole('alert')).toContainText('読み込めません');
  await scene(page);
  await page
    .getByRole('button', { name: '進行全体を移調', exact: true })
    .click();
  await expect(page.locator('.timeline .event')).toContainText('E7');
});
test('loop, pause/resume, tempo changes and smooth comparison stop cleanly', async ({
  page,
}) => {
  await enable(page);
  await page
    .getByRole('combobox', { name: '長さ（拍）', exact: true })
    .selectOption('1');
  for (const name of ['C I', 'G V', 'Am vi', 'F IV']) await chord(page, name);
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
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await sounding(page);
  await expand(page, '.editor-disclosure');
  await page
    .getByRole('spinbutton', { name: '長さ（拍）', exact: true })
    .fill('2');
  await page.getByLabel('BPM', { exact: true }).fill('150');
  await page
    .getByRole('button', { name: 'B: Smoothを聴く', exact: true })
    .click();
  await sounding(page);
  await page.waitForTimeout(1500);
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
  await stop(page);
  await scene(page, '設定');
  await expect(page.getByText(/ブラウザ保存を利用できません/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを書き出す' }).click();
  expect((await download).suggestedFilename()).toBe('chordscape-session.json');
});
test('suspension resumes at the held beat; paused clear discards the snapshot', async ({
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
  ).toBeEnabled();
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await sounding(page);
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await page.getByRole('button', { name: '全消去', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '再開', exact: true }),
  ).toHaveCount(0);
  await silent(page);
});
test('all four sounds play, samples use the production subpath, and switching stops audio', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('.mp3')) requests.push(r.url());
  });
  await enable(page);
  await expect(
    page.getByRole('button', { name: '演奏する音色: Piano', exact: true }),
  ).toBeVisible();
  await chord(page, 'C I');
  await sounding(page);
  await stop(page);
  for (const instrument of ['electric', 'pad', 'piano', 'soft']) {
    await scene(page, '設定');
    await page.getByLabel('音色', { exact: true }).selectOption(instrument);
    await expect(
      page.getByText('Pianoを読み込み中…', { exact: true }),
    ).toHaveCount(0);
    await silent(page);
    await scene(page);
    await chord(page, 'C I');
    await sounding(page);
    await stop(page);
    await silent(page);
  }
  expect(requests).toHaveLength(17);
  for (const url of requests)
    expect(url).toContain(
      `${process.env.VITE_BASE_PATH || '/'}samples/salamander/`,
    );
  await scene(page, '設定');
  await expect(page.getByText(/Piano: Salamander Grand Piano/)).toBeVisible();
});
test('failed piano load falls back, supports retry, and never plays a delayed chord', async ({
  page,
}) => {
  await page.route('**/samples/salamander/*.mp3', (r) =>
    r.fulfill({ status: 503, body: 'unavailable' }),
  );
  await enable(page);
  await scene(page, '設定');
  await page.getByLabel('音色', { exact: true }).selectOption('piano');
  await expect(page.getByRole('alert')).toContainText('Electric piano');
  await scene(page);
  await chord(page, 'C I');
  await sounding(page);
  await stop(page);
  await page.unroute('**/samples/salamander/*.mp3');
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '演奏する音色: Piano', exact: true }),
  ).toBeVisible();
  await silent(page);
  await chord(page, 'C I');
  await sounding(page);
  await stop(page);
  await silent(page);
});
test('the first attack stays bounded and rapid stop cancels voices before they start', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      createDynamicsCompressor() {
        const compressor = super.createDynamicsCompressor();
        const monitor = super.createAnalyser();
        monitor.fftSize = 32768;
        monitor.smoothingTimeConstant = 0;
        compressor.connect(monitor);
        (
          window as typeof window & { audioMonitor?: AnalyserNode }
        ).audioMonitor = monitor;
        return compressor;
      }
    };
  });
  await page.reload();
  await enable(page);
  for (const instrument of ['electric', 'pad', 'soft']) {
    await scene(page, '設定');
    await page.getByLabel('音色', { exact: true }).selectOption(instrument);
    await scene(page);
    await chord(page, 'C I');
    await page.waitForTimeout(400);
    const metrics = await page.evaluate(() => {
      const monitor = (window as typeof window & { audioMonitor: AnalyserNode })
        .audioMonitor;
      const samples = new Float32Array(monitor.fftSize);
      monitor.getFloatTimeDomainData(samples);
      const bins = new Float32Array(monitor.frequencyBinCount);
      monitor.getFloatFrequencyData(bins);
      let peak = 0,
        step = 0,
        mean = 0,
        power = 0,
        low = 0;
      for (let i = 0; i < samples.length; i++) {
        peak = Math.max(peak, Math.abs(samples[i]));
        mean += samples[i];
        if (i) step = Math.max(step, Math.abs(samples[i] - samples[i - 1]));
      }
      for (let i = 0; i < bins.length; i++) {
        const energy = 10 ** (bins[i] / 10);
        power += energy;
        if ((i * monitor.context.sampleRate) / monitor.fftSize < 35)
          low += energy;
      }
      return {
        peak,
        step,
        mean: Math.abs(mean / samples.length),
        lowRatio: low / power,
      };
    });
    expect(metrics.peak).toBeGreaterThan(0.001);
    expect(metrics.peak).toBeLessThan(0.5);
    expect(metrics.step).toBeLessThan(0.04);
    expect(metrics.mean).toBeLessThan(0.002);
    expect(metrics.lowRatio).toBeLessThan(0.005);
    await stop(page);
    await silent(page);
  }
  await page
    .getByRole('button', { name: 'C I', exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (document.querySelector('.stop') as HTMLButtonElement).click();
    });
  await page.waitForTimeout(200);
  await silent(page);
  await expect(page.locator('[data-active="true"]')).toHaveCount(0);
});
test('stop fades continuously during attack, decay and release', async ({
  page,
}) => {
  // Execute the actual voice implementation with a deterministic browser clock.
  const voiceModule = ts.transpileModule(
    readFileSync('src/audio/voices.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const results = await page.evaluate(async (code) => {
    const url = URL.createObjectURL(
      new Blob([code], { type: 'text/javascript' }),
    );
    const { createNoteVoice } = (await import(
      /* @vite-ignore */ url
    )) as typeof import('../../src/audio/voices');
    URL.revokeObjectURL(url);
    const results = [];
    for (const instrument of ['electric', 'pad', 'soft'] as const) {
      for (const stopAt of [0.01, 0.04, 0.2, 0.4, 0.65, 0.95, 1.02]) {
        const context = new OfflineAudioContext(1, 48000 * 1.2, 48000);
        const master = context.createGain();
        master.gain.value = 0.5;
        master.connect(context.destination);
        const filter = context.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 35;
        filter.Q.value = 0.5;
        filter.connect(master);
        const voices = [48, 52, 55].map((midi) =>
          createNoteVoice(
            context,
            filter,
            instrument,
            midi,
            0.03,
            1,
            new Map(),
          ),
        );
        const stopped = context.suspend(stopAt).then(() => {
          voices.forEach((voice) => voice.stop(context.currentTime));
          return context.resume();
        });
        const buffer = await context.startRendering();
        await stopped;
        const samples = buffer.getChannelData(0);
        let step = 0,
          tail = 0,
          peak = 0;
        for (let i = 0; i < samples.length; i++) {
          peak = Math.max(peak, Math.abs(samples[i]));
          if (i) step = Math.max(step, Math.abs(samples[i] - samples[i - 1]));
          if (i / context.sampleRate > stopAt + 0.1)
            tail = Math.max(tail, Math.abs(samples[i]));
        }
        results.push({ instrument, stopAt, step, tail, peak });
        voices.forEach((voice) => voice.dispose());
      }
    }
    return results;
  }, voiceModule);
  for (const result of results) {
    expect(result.step, JSON.stringify(result)).toBeLessThan(0.01);
    expect(result.tail, JSON.stringify(result)).toBeLessThan(0.0001);
    if (result.stopAt < 0.03) expect(result.peak).toBe(0);
  }
});

test('library shows all 33 chords, selects before audio, auditions by button and keeps the progression unchanged', async ({
  page,
}) => {
  await scene(page, 'コード辞典');
  const buttons = page.locator('.library-chords button');
  await expect(buttons).toHaveCount(33);
  await page.getByRole('button', { name: 'Cmaj7', exact: true }).click();
  await expect(page.getByTestId('chord-symbol')).toHaveText('Cmaj7');
  await enable(page);
  const symbols = [
    'C',
    'Cm',
    'Cdim',
    'Caug',
    'Csus2',
    'Csus4',
    'Cmaj7',
    'C7',
    'Cm7',
    'Cm(maj7)',
    'Cm7♭5',
    'Cdim7',
    'C6',
    'Cm6',
    'Cadd9',
    'Cm(add9)',
    'C6/9',
    'C7sus4',
    'Cmaj9',
    'C9',
    'Cm9',
    'C11',
    'Cm11',
    'C13',
    'Cm13',
    'Cmaj13',
    'Cmaj7(♯11)',
    'Cmaj7♯5',
    'C7♭5',
    'C7♯5',
    'C7♭9',
    'C7♯9',
    'C7(♭9,♯5)',
  ];
  await expect(buttons).toHaveText(symbols);
  await expect(page.locator('.library-quality-group h3')).toHaveText([
    'Basic',
    'Seventh',
    'Added tones / Sixth',
    'Extensions',
    'Altered',
  ]);
  for (const name of symbols) {
    const button = page
      .locator('.library-chords')
      .getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('chord-symbol')).toHaveText(name);
  }
  await page
    .locator('.library-chords')
    .getByRole('button', { name: 'Cm9', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: '根音', exact: true })
    .selectOption('D♭');
  await expect(buttons).toHaveCount(33);
  await expect(
    page.getByRole('button', { name: 'D♭m9', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'D♭7', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chord-symbol')).toHaveText('D♭7');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 812 });
    for (const group of await page.locator('.library-quality-row').all()) {
      const boxes = await group.locator('button').evaluateAll((buttons) =>
        buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          return { top: Math.round(rect.top), right: rect.right };
        }),
      );
      expect(new Set(boxes.slice(0, 6).map((box) => box.top)).size).toBe(1);
      expect(new Set(boxes.map((box) => box.top)).size).toBe(
        boxes.length === 9 ? 2 : 1,
      );
      expect(Math.max(...boxes.map((box) => box.right))).toBeLessThanOrEqual(
        width,
      );
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await scene(page);
  await expect(page.locator('.timeline li')).toHaveCount(0);
});

test('extended sixth inversion preserves seven notes and bass after reload', async ({
  page,
}) => {
  await enable(page);
  await scene(page, 'コード辞典');
  await page.getByRole('button', { name: 'Cmaj13', exact: true }).click();
  await page.getByRole('button', { name: '進行へ追加', exact: true }).click();
  await page
    .getByRole('combobox', { name: '和音の構成: 転回・bass指定', exact: true })
    .selectOption('6');
  await expect(page.getByTestId('chord-symbol')).toHaveText('Cmaj13/A');
  await expect(page.locator('.chord-summary .badge')).toHaveText('第6転回');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('chordscape.session.v4');
        return raw ? JSON.parse(raw).events[0]?.bass : null;
      }),
    )
    .toBe(6);
  await page.reload();
  await expect(page.getByTestId('chord-symbol')).toHaveText('Cmaj13/A');
  await expect(page.locator('.chord-summary .badge')).toHaveText('第6転回');
});

test('outside presets keep the requested order and transpose by degree', async ({
  page,
}) => {
  await expand(page, '.outside');
  const names = page.locator('.outside .palette button strong');
  await expect(names).toHaveText([
    'A7',
    'B7',
    'C7',
    'D7',
    'E7',
    'F♯7',
    'C♯dim7',
    'D♯dim7',
    'F♯dim7',
    'G♯dim7',
    'Cm',
    'E♭',
    'Fm',
    'Gm',
    'A♭',
    'B♭',
    'Fm7',
    'A♭maj7',
    'B♭7',
    'D♭7',
    'E♭7',
    'A♭7',
    'F7',
    'D♭',
    'Caug',
    'Gaug',
    'Am(maj7)',
  ]);
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('D');
  await expect(names).toHaveText([
    'B7',
    'C♯7',
    'D7',
    'E7',
    'F♯7',
    'G♯7',
    'D♯dim7',
    'E♯dim7',
    'G♯dim7',
    'A♯dim7',
    'Dm',
    'F',
    'Gm',
    'Am',
    'B♭',
    'C',
    'Gm7',
    'B♭maj7',
    'C7',
    'E♭7',
    'F7',
    'B♭7',
    'G7',
    'E♭',
    'Daug',
    'Aaug',
    'Bm(maj7)',
  ]);
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('C');
  await page.locator('.key-panel select').nth(1).selectOption('minor');
  await expect(names).toHaveText([
    'G',
    'G7',
    'Bdim',
    'Bdim7',
    'Cm(maj7)',
    'E♭aug',
    'E♭maj7♯5',
    'Dm7',
    'F',
    'F7',
    'Am7♭5',
    'Bm7♭5',
    'C',
    'Cmaj7',
    'Dm',
    'Em',
    'Em7',
    'A',
    'Am',
    'Am7',
    'C7',
    'D7',
    'E♭7',
    'F7',
    'A7',
    'D♭',
    'A♭7',
  ]);
  await page
    .locator('.outside')
    .getByRole('button', { name: '＋ 追加', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: '根音', exact: true })
    .selectOption('F');
  await dialog.getByRole('button', { name: 'F7', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: '追加済み', exact: true }),
  ).toBeDisabled();
});
