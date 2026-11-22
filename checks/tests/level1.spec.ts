import { expect, test, type Page } from '@playwright/test';

async function waitForBoard(page: Page): Promise<void> {
  await expect(page.getByTestId('board')).not.toHaveAttribute('data-state', 'loading', { timeout: 12000 });
}

test.describe('level-1', () => {
  test('Seite antwortet mit HTTP 200', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
  });

  test('Titel ist „Levelboard“', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Levelboard');
  });

  test('10 Level-Karten sichtbar', async ({ page }) => {
    await page.goto('/');
    await waitForBoard(page);
    const cards = page.getByTestId('level-card');
    await expect(cards).toHaveCount(10);
    const count = await cards.count();
    for (let index = 0; index < count; index += 1) {
      await expect(cards.nth(index)).toBeVisible();
    }
  });

  test('Keine Konsolenfehler', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await page.goto('/');
    await waitForBoard(page);
    await page.waitForTimeout(250);
    expect(errors).toEqual([]);
  });

  test('Handy-Ansicht: Karten einspaltig', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await waitForBoard(page);
    const cards = page.getByTestId('level-card');
    await expect(cards).toHaveCount(10);
    const positions = await cards.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().x)),
    );
    expect(new Set(positions).size).toBe(1);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });
});
