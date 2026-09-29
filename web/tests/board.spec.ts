import { test, expect } from '@playwright/test';
test('two clients merge offline text edits and retain the board after reload', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#room=test-' + crypto.randomUUID().slice(0, 8));
  const other = await browser.newPage();
  await other.goto(page.url());
  await expect(page.locator('footer')).toContainText('2 people');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel('Note text').fill('Shared idea');
  await expect(other.getByTestId('board-item')).toHaveCount(1);
  await expect(other.getByTestId('board-item')).toContainText('Shared idea');
  await page.context().setOffline(true);
  await page.getByLabel('Note text').fill('Shared idea offline');
  await other.getByTestId('board-item').click();
  await other.getByLabel('Note text').fill('Shared idea online');
  await page.context().setOffline(false);
  await expect(other.getByTestId('board-item')).toContainText('offline', { timeout: 15000 });
  await expect(page.getByTestId('board-item')).toContainText('online');
  const content = await page.getByTestId('board-item').textContent();
  await page.reload();
  await expect(page.getByTestId('board-item')).toHaveText(content!);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await other.close();
});
