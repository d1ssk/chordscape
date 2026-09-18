import { test, expect, type Page } from '@playwright/test';
const level = (page: Page) =>
  page.getByTestId('audio-level').getAttribute('value').then(Number);

test('first chord tap starts piano and records once; saved playback also starts directly', async ({
  page,
}) => {
  await page.goto('./');
  await expect.poll(() => level(page)).toBe(0);
  const chord = page.getByRole('button', { name: 'C I', exact: true });
  await expect(chord).toBeEnabled();
  await chord.click();
  await expect.poll(() => level(page)).toBeGreaterThan(0.001);
  await expect(page.locator('.timeline li')).toHaveCount(1);
  await page.getByRole('button', { name: '■ 停止', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('chordscape.session.v5') ?? '{}')
            .events?.length,
      ),
    )
    .toBe(1);
  await page.reload();
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect.poll(() => level(page)).toBeGreaterThan(0.001);
});

test('dictionary keyboard audition starts audio on the first press without adding to the progression', async ({
  page,
}) => {
  await page.goto('./#library');
  await page.getByRole('button', { name: 'Cm7', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => level(page)).toBeGreaterThan(0.001);
  await expect(page.getByTestId('chord-symbol')).toHaveText('Cm7');
  await page.getByRole('button', { name: '進行へ追加', exact: true }).click();
  await expect(page.locator('.timeline li')).toHaveCount(1);
});

for (const cancel of ['stop', 'navigation', 'edit'] as const) {
  test(`first tap never plays late after ${cancel} during loading`, async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/samples/salamander/*.mp3', async (route) => {
      await gate;
      await route.continue();
    });
    try {
      await page.goto('./');
      await page.getByRole('button', { name: 'C I', exact: true }).click();
      await expect(
        page.getByText('Pianoを読み込み中…', { exact: true }),
      ).toBeVisible();
      if (cancel === 'stop')
        await page.getByRole('button', { name: '■ 停止', exact: true }).click();
      else if (cancel === 'navigation')
        await page
          .getByRole('navigation')
          .getByRole('button', { name: 'コード辞典', exact: true })
          .click();
      else
        await page
          .getByRole('combobox', { name: '調', exact: true })
          .selectOption('D');
      release();
      await expect(
        page.getByText('Pianoを読み込み中…', { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: '演奏する音色: Piano', exact: true }),
      ).toBeVisible();
      await expect.poll(() => level(page)).toBe(0);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse(localStorage.getItem('chordscape.session.v5') ?? '{}')
                .events?.length,
          ),
        )
        .toBe(0);
      await page.waitForTimeout(200);
      expect(await level(page)).toBe(0);
    } finally {
      release();
    }
  });
}

test('first tap still sounds with fallback if piano samples fail', async ({
  page,
}) => {
  await page.route('**/samples/salamander/*.mp3', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  await page.goto('./');
  await page.getByRole('button', { name: 'C I', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Electric piano');
  await expect.poll(() => level(page)).toBeGreaterThan(0.001);
});
