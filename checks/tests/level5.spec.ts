import { expect, test } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://127.0.0.1:8081';

test.describe.configure({ mode: 'serial' });

test.describe('level-5', () => {
  test('Seite liest aus dem Backend', async ({ page, request }) => {
    const config = await request.get('/config.json');
    expect(await config.json()).toEqual({ source: 'api' });
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 12000 });
    await expect(page.getByTestId('run-source')).toHaveAttribute('data-source', 'api');
    await expect(page.getByTestId('run-source')).toHaveText('Backend');
  });

  test('nginx leitet /api/ an das Backend weiter', async ({ request }) => {
    const viaProxy = await request.get('/api/health');
    const direct = await request.get(`${API_URL}/api/health`);
    expect(viaProxy.status()).toBe(200);
    expect(viaProxy.headers()['content-type']).toBe('application/json');
    expect(await viaProxy.json()).toEqual(await direct.json());
    const missing = await request.get('/api/unbekannt');
    expect(missing.status()).toBe(404);
    expect(typeof (await missing.json()).error).toBe('string');
  });

  test('Gemeldetes Ergebnis erscheint ohne Neuladen', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 12000 });
    const response = await request.post('/api/levels/1/result', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ checks: [{ name: 'Probe', ok: true }], durationMs: 4242 }),
    });
    expect(response.status()).toBe(200);
    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card).toHaveAttribute('data-status', 'bestanden', { timeout: 8000 });
    await expect(card.getByTestId('level-duration')).toHaveText('4,2 s', { timeout: 8000 });
  });

  test('Backend-Ausfall wird angezeigt', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 12000 });
    await page.route('**/api/levels', (route) =>
      route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Ausfall</html>' }),
    );
    await expect(page.getByTestId('notice')).toHaveAttribute('data-kind', 'unavailable', { timeout: 9000 });
    await expect(page.locator('[data-testid="level-card"]')).toHaveCount(10);
    await expect(page.locator('[data-testid="level-card"][data-status="offen"]')).toHaveCount(10);
    await page.unroute('**/api/levels');
    await expect(page.getByTestId('notice')).toHaveCount(0, { timeout: 9000 });
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 9000 });
  });

  test('Meldungen über nginx landen in der Historie', async ({ request }) => {
    const response = await request.post('/api/levels/1/result', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        checks: [{ name: 'Probe über nginx', ok: true }],
        durationMs: 5151,
      }),
    });
    expect(response.status()).toBe(200);
    const history = await request.get('/api/levels/1/history?limit=1');
    expect(history.status()).toBe(200);
    const body = await history.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].durationMs).toBe(5151);
    expect(body.entries[0].checks).toEqual([{ name: 'Probe über nginx', ok: true }]);
  });
});
