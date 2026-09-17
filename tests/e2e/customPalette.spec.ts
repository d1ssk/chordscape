import { test, expect } from '@playwright/test';

test('custom palette adds, plays, persists, deduplicates and removes chords', async ({
  page,
}) => {
  await page.goto('./');
  const outside = page.locator('.outside');
  await outside.locator('summary').click();
  const count = await outside.locator('.palette button').count();
  const open = outside.getByRole('button', { name: '＋ 追加', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.library-chords button')).toHaveCount(33);
  await dialog.getByRole('button', { name: 'Cmaj9', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'パレットへ追加', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: '追加済み', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.timeline li')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('chordscape.customPalette.v1') ?? '[]',
          ).length,
      ),
    )
    .toBe(1);
  await dialog
    .getByRole('combobox', { name: '根音', exact: true })
    .selectOption('D♭');
  await dialog.getByRole('button', { name: 'D♭m9', exact: true }).focus();
  await page.keyboard.press('Enter');
  await dialog
    .getByRole('button', { name: 'パレットへ追加', exact: true })
    .click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 812 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(open).toBeFocused();
  await expect(outside.locator('.palette button')).toHaveCount(count + 2);
  await page.getByRole('button', { name: '音声を開始', exact: true }).click();
  const added = outside.getByRole('button', { name: /^Cmaj9 / });
  await expect(added).toBeEnabled();
  await added.click();
  await expect(page.getByTestId('chord-symbol')).toHaveText('Cmaj9');
  await expect
    .poll(async () =>
      Number(await page.getByTestId('audio-level').getAttribute('value')),
    )
    .toBeGreaterThan(0.001);
  await page.getByRole('button', { name: '■ 停止', exact: true }).click();
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('G');
  await expect(outside.getByRole('button', { name: /^Cmaj9 / })).toHaveCount(1);
  await page.reload();
  await outside.locator('summary').click();
  await expect(outside.getByRole('button', { name: /^Cmaj9 / })).toHaveCount(1);
  await expect(outside.getByRole('button', { name: /^D♭m9 / })).toHaveCount(1);
  await open.click();
  await dialog.getByRole('button', { name: 'Cmaj9 削除', exact: true }).click();
  await dialog.getByRole('button', { name: 'D♭m9 削除', exact: true }).click();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await page
    .getByRole('combobox', { name: '調', exact: true })
    .selectOption('C');
  await open.click();
  await dialog
    .getByRole('combobox', { name: '根音', exact: true })
    .selectOption('F');
  await dialog.getByRole('button', { name: 'Fm', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: '追加済み', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.reload();
  await outside.locator('summary').click();
  await expect(outside.locator('.palette button')).toHaveCount(count);
});

test('custom palette stays usable when browser storage is blocked', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
  });
  await page.goto('./');
  const outside = page.locator('.outside');
  await outside.locator('summary').click();
  await outside.getByRole('button', { name: '＋ 追加', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cmaj9', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'パレットへ追加', exact: true })
    .click();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(outside.getByRole('status')).toContainText('保存できません');
  await expect(outside.getByRole('button', { name: /^Cmaj9 / })).toHaveCount(1);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'コード辞典', exact: true })
    .click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '演奏', exact: true })
    .click();
  await outside.locator('summary').click();
  await expect(outside.getByRole('button', { name: /^Cmaj9 / })).toHaveCount(1);
});

test('invalid saved palette does not break the default chords', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chordscape.customPalette.v1',
      '[{"root":"C","quality":"__proto__"}]',
    );
  });
  await page.goto('./');
  const outside = page.locator('.outside');
  await outside.locator('summary').click();
  await expect(outside.getByRole('status')).toBeVisible();
  expect(await outside.locator('.palette button').count()).toBeGreaterThan(20);
  await outside.getByRole('button', { name: '＋ 追加', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cmaj9', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'パレットへ追加', exact: true })
    .click();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(outside.getByRole('status')).toHaveCount(0);
});
