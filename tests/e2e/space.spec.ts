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
    .getByRole('button', { name: '和声空間', exact: true })
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
  await expect(page.locator('.space-readout strong')).toHaveText(
    /^Am(?:\/[A-G].*)?$/,
  );
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

test('compact map fits without scrolling, overlap or clipped labels', async ({
  page,
}, testInfo) => {
  const sizes =
    testInfo.project.name === 'mobile'
      ? [
          { width: 320, height: 667 },
          { width: 375, height: 667 },
          { width: 390, height: 844 },
        ]
      : [
          { width: 1280, height: 720 },
          { width: 768, height: 1024 },
        ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto('./#space');
    const problems = await page.locator('.space-node').evaluateAll((nodes) => {
      const map = document.querySelector('.space-map')!.getBoundingClientRect();
      const nav = document.querySelector('.scene-nav')!.getBoundingClientRect();
      const boxes = nodes.map((node) => ({
        id: node.getAttribute('data-node-id'),
        box: node.getBoundingClientRect(),
        element: node,
      }));
      return boxes.flatMap((a, i) => [
        ...boxes
          .slice(i + 1)
          .filter(
            (b) =>
              a.box.left < b.box.right &&
              a.box.right > b.box.left &&
              a.box.top < b.box.bottom &&
              a.box.bottom > b.box.top,
          )
          .map((b) => `overlap ${a.id}/${b.id}`),
        ...(a.box.left < map.left ||
        a.box.right > map.right ||
        a.box.top < map.top ||
        a.box.bottom > map.bottom
          ? [`outside map ${a.id}`]
          : []),
        ...(a.box.bottom > nav.top || a.box.top < 0
          ? [`outside viewport ${a.id}`]
          : []),
        ...(a.element.scrollWidth > a.element.clientWidth ||
        a.element.scrollHeight > a.element.clientHeight
          ? [`clipped text ${a.id}`]
          : []),
      ]);
    });
    expect(problems, `${size.width} × ${size.height}`).toEqual([]);
    const keySelect = page.getByRole('combobox', { name: '和声空間の調' });
    const tonics = await keySelect
      .locator('option')
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value),
      );
    for (const tonic of tonics) {
      await keySelect.selectOption(tonic);
      const clipped = await page
        .locator('.space-node')
        .evaluateAll((nodes) =>
          nodes
            .filter(
              (n) =>
                n.scrollWidth > n.clientWidth ||
                n.scrollHeight > n.clientHeight,
            )
            .map((n) => n.textContent),
        );
      expect(clipped, `${tonic} major at ${size.width}px`).toEqual([]);
    }
    await keySelect.selectOption('C');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator('.space-node')).toHaveCount(42);
    await page.screenshot({
      path: testInfo.outputPath(`harmonic-space-${size.width}.png`),
      fullPage: true,
    });
  }
  for (const id of ['abmaj7', 'dsdim7', 'fs7', 'db7', 'c']) {
    await node(page, id).focus();
    await expect(node(page, id)).toBeInViewport();
  }
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
        .getByRole('button', { name: '和声空間', exact: true })
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
    .getByRole('button', { name: '和声空間', exact: true })
    .click();
  await expect.poll(() => level(page)).toBe(0);
  await node(page, 'g').click();
  await expect(page.locator('.space-readout strong')).toHaveText(
    /^G(?:\/[A-G].*)?$/,
  );
});

test('history fill and suggestion halos coexist; style preserves context and key clears it', async ({
  page,
}, testInfo) => {
  await page.goto('./#space');
  const guide = page.locator('.space-node[data-suggestion]');
  await expect(guide).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Free', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const positions = () =>
    page.locator('.space-node').evaluateAll((nodes) =>
      nodes.map((n) => ({
        x: (n as HTMLElement).style.getPropertyValue('--space-x'),
        y: (n as HTMLElement).style.getPropertyValue('--space-y'),
      })),
    );
  const geography = await positions();
  await page.getByRole('button', { name: 'Pop', exact: true }).click();
  for (const id of ['c', 'f', 'fm']) {
    await node(page, id).click();
    await expect(node(page, id)).toHaveAttribute('data-history', '0');
  }
  await expect(guide).toHaveCount(6);
  await expect(node(page, 'c')).toHaveAttribute('data-history', '2');
  await expect(node(page, 'c')).toHaveAttribute('data-suggestion', 'resolve');
  await expect(node(page, 'c')).toHaveCSS(
    'background-color',
    'rgb(165, 168, 171)',
  );
  expect(
    await node(page, 'c').evaluate((n) => getComputedStyle(n).boxShadow),
  ).not.toBe('none');
  await expect(node(page, 'fm')).toHaveAttribute('aria-current', 'true');
  await page.screenshot({
    path: testInfo.outputPath('harmonic-space-history.png'),
    fullPage: true,
  });
  const before = await guide.evaluateAll((nodes) =>
    nodes.map((n) => [
      n.getAttribute('data-node-id'),
      n.getAttribute('data-score'),
    ]),
  );
  await page.getByRole('button', { name: 'Jazz', exact: true }).click();
  const after = await guide.evaluateAll((nodes) =>
    nodes.map((n) => [
      n.getAttribute('data-node-id'),
      n.getAttribute('data-score'),
    ]),
  );
  expect(after).not.toEqual(before);
  await expect(node(page, 'fm')).toHaveAttribute('data-history', '0');
  await expect(node(page, 'c')).toHaveAttribute('data-history', '2');
  expect(await positions()).toEqual(geography);
  await stop(page);
  await expect(page.locator('.space-node[data-sounding]')).toHaveCount(0);
  await page.getByRole('combobox', { name: '和声空間の調' }).selectOption('D');
  await expect(page.locator('.space-node[data-history]')).toHaveCount(0);
  await expect(guide).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Jazz', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(node(page, 'a7')).toHaveText('B7');
  await expect(node(page, 'dm')).toHaveText('Em');
  expect(await positions()).toEqual(geography);
  await node(page, 'c').click();
  await expect(page.locator('.space-readout')).toContainText('D3 · F♯3 · A3');
  await page.getByRole('combobox', { name: '和声空間の調' }).selectOption('F♯');
  await expect(node(page, 'bdim')).toHaveText('E♯°');
  await expect.poll(() => level(page)).toBe(0);
});

test('key change cancels a pending first audition and never restores old context', async ({
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
    await page.goto('./#space');
    await node(page, 'c').click();
    await expect(
      page.getByText('Pianoを読み込み中…', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: '和声空間の調' })
      .selectOption('D');
    release();
    await expect(
      page.getByText('Pianoを読み込み中…', { exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => level(page)).toBe(0);
    await expect(page.locator('.space-node[data-history]')).toHaveCount(0);
    await expect(page.locator('.space-node[data-suggestion]')).toHaveCount(0);
    await node(page, 'a7').click();
    await expect(node(page, 'a7')).toHaveAttribute('data-history', '0');
    await expect(page.locator('.space-readout strong')).toHaveText('B7');
  } finally {
    release();
  }
});
