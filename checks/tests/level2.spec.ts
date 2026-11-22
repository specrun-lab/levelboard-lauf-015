import { expect, test } from '@playwright/test';

function firstScriptPath(html: string): string {
  const match = html.match(/<script[^>]+src="([^"]+\.js)"/);
  if (!match) throw new Error('Keine JS-Datei in index.html gefunden');
  return match[1];
}

test.describe('level-2', () => {
  test('Antwort kommt von nginx', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['server']).toBe('nginx');
  });

  test('results.json wird nicht zwischengespeichert', async ({ request }) => {
    const response = await request.get('/results.json');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
  });

  test('index.html wird nicht zwischengespeichert', async ({ request }) => {
    const response = await request.get('/');
    expect(response.headers()['cache-control']).toBe('no-cache');
  });

  test('Assets werden ein Jahr zwischengespeichert', async ({ request }) => {
    const index = await request.get('/');
    const script = firstScriptPath(await index.text());
    const response = await request.get(script);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  test('Fehlende Datei ergibt 404', async ({ request }) => {
    const response = await request.get('/gibt-es-nicht.json');
    expect(response.status()).toBe(404);
  });

  test('Antworten sind gzip-komprimiert', async ({ request }) => {
    const headers = { 'Accept-Encoding': 'gzip' };
    const index = await request.get('/', { headers });
    expect(index.headers()['content-encoding']).toBe('gzip');
    const script = firstScriptPath(await index.text());
    const javascript = await request.get(script, { headers });
    expect(javascript.headers()['content-encoding']).toBe('gzip');
    const results = await request.get('/results.json', { headers });
    expect(results.headers()['content-encoding']).toBe('gzip');
  });

  test('Seite funktioniert über nginx', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 12000 });
    await expect(page.getByTestId('level-card')).toHaveCount(10);
    await page.waitForTimeout(250);
    expect(errors).toEqual([]);
  });
});
