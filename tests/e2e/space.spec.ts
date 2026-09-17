import { test, expect, type Page } from '@playwright/test';
const level = (page: Page) =>
  page.getByTestId('audio-level').getAttribute('value').then(Number);
const stored = (page: Page) =>
  page.evaluate(() => localStorage.getItem('chordscape.session.v4'));
const node = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
const stop = (page: Page) =>
  page.getByRole('button', { name: '■ 停止', exact: true }).click();

test('independent exploration keeps the saved progression, key and settings; supports keyboard and slash bass', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'C I', exact: true }).click();
  await expect(page.locator('.timeline li')).toHaveCount(1);
  await stop(page);
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('D');
  await expect
    .poll(
      async () =>
        JSON.parse((await stored(page)) ?? '{}').settings?.key.tonic.letter,
    )
    .toBe('D');
  const before = await stored(page);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'コード探索', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'C major の和声空間' }),
  ).toBeVisible();
  await expect(page.locator('.space-node')).toHaveCount(42);
  await expect(
    page.getByRole('button', { name: '再生', exact: true }),
  ).toHaveCount(0);
  await node(page, 'c').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => level(page)).toBeGreaterThan(0.001);
  await expect(page.locator('.space-readout')).toContainText('C3 · E3 · G3');
  await page.keyboard.press('ArrowLeft');
  await expect(node(page, 'am')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('.space-readout strong')).toHaveText('Am');
  await node(page, 'db-f').click();
  await expect(page.locator('.space-readout')).toContainText('最低音: F3');
  await stop(page);
  await expect.poll(() => level(page)).toBe(0);
  expect(await stored(page)).toBe(before);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '演奏', exact: true })
    .click();
  await expect(page.locator('.timeline li')).toHaveCount(1);
  await expect(
    page.getByRole('combobox', { name: '調', exact: true }),
  ).toHaveValue('D');
  await page
    .locator('.app-header')
    .getByRole('button', { name: '設定', exact: true })
    .click();
  await expect(page).toHaveURL(/#settings$/);
});

test('map has no overlapping nodes or page overflow and all nodes remain reachable', async ({
  page,
}, testInfo) => {
  await page.goto('./#space');
  const problems = await page.locator('.space-node').evaluateAll((nodes) => {
    const boxes = nodes.map((node) => ({
      id: node.getAttribute('data-node-id'),
      box: node.getBoundingClientRect(),
    }));
    return boxes.flatMap((a, i) =>
      boxes
        .slice(i + 1)
        .filter(
          (b) =>
            a.box.left < b.box.right &&
            a.box.right > b.box.left &&
            a.box.top < b.box.bottom &&
            a.box.bottom > b.box.top,
        )
        .map((b) => `${a.id}/${b.id}`),
    );
  });
  expect(problems).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const id of ['abmaj7', 'dsdim7', 'fs7', 'db7', 'c']) {
    await node(page, id).focus();
    await expect(node(page, id)).toBeInViewport();
  }
  if (testInfo.project.name === 'desktop')
    await page.setViewportSize({ width: 1280, height: 1400 });
  else {
    await page.setViewportSize({ width: 320, height: 812 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath('harmonic-space.png'),
    fullPage: true,
  });
});

for (const cancel of ['stop', 'navigation', 'back'] as const) {
  test(`first exploration tap does not play late after ${cancel}`, async ({
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
      await page
        .getByRole('navigation')
        .getByRole('button', { name: 'コード探索', exact: true })
        .click();
      await node(page, 'c').click();
      await expect(
        page.getByText('Pianoを読み込み中…', { exact: true }),
      ).toBeVisible();
      if (cancel === 'stop') await stop(page);
      else if (cancel === 'back') await page.goBack();
      else
        await page
          .locator('.app-header')
          .getByRole('button', { name: '設定', exact: true })
          .click();
      release();
      await expect(
        page.getByText('Pianoを読み込み中…', { exact: true }),
      ).toHaveCount(0);
      await expect.poll(() => level(page)).toBe(0);
      await expect
        .poll(
          async () => JSON.parse((await stored(page)) ?? '{}').events?.length,
        )
        .toBe(0);
      await page.waitForTimeout(200);
      expect(await level(page)).toBe(0);
    } finally {
      release();
    }
  });
}

test('first click sounds directly and scene changes stop both timeline and exploration', async ({
  page,
}) => {
  await page.goto('./#space');
  await node(page, 'fm').click();
  await expect.poll(() => level(page)).toBeGreaterThan(0.001);
  await expect(page.locator('.space-readout strong')).toHaveText('Fm');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '演奏', exact: true })
    .click();
  await expect.poll(() => level(page)).toBe(0);
  await page.getByRole('button', { name: 'C I', exact: true }).click();
  await stop(page);
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect.poll(() => level(page)).toBeGreaterThan(0.001);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'コード探索', exact: true })
    .click();
  await expect.poll(() => level(page)).toBe(0);
  await node(page, 'g').click();
  await expect(page.locator('.space-readout strong')).toHaveText('G');
});
