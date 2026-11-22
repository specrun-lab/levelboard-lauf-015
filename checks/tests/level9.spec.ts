import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadtest } from '../loadtest.mjs';

const LIVE_URL = (process.env.LIVE_URL || '').replace(/\/$/, '');
const RUN_ID = process.env.RUN_ID || '';

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

function firstScriptPath(html: string): string {
  const match = html.match(/<script[^>]+src="([^"]+\.js)"/);
  if (!match) throw new Error('Keine JS-Datei in index.html gefunden');
  return match[1];
}

test.describe('level-9', () => {
  test('Live-Seite zeigt Kopfzeile und 10 Karten', async ({ page }) => {
    expect(LIVE_URL.startsWith('https://')).toBe(true);
    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 20000 });
    await expect(page.getByTestId('run-id')).toHaveText(RUN_ID);
    await expect(page.getByTestId('run-commit')).toHaveText(/^[0-9a-f]{7}$/);
    await expect(page.getByTestId('level-card')).toHaveCount(10);
  });

  test('Cache- und gzip-Regeln gelten live', async ({ request }) => {
    const index = await request.get(`${LIVE_URL}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(index.status()).toBe(200);
    expect(index.headers()['cache-control']).toBe('no-cache');
    expect(index.headers()['content-encoding']).toBe('gzip');
    const script = firstScriptPath(await index.text());
    const asset = await request.get(`${LIVE_URL}${script}`);
    expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    const config = await request.get(`${LIVE_URL}/config.json`);
    expect(config.headers()['cache-control']).toBe('no-store');
    const missing = await request.get(`${LIVE_URL}/gibt-es-nicht.json`);
    expect(missing.status()).toBe(404);
  });

  test('Live-API antwortet laut Spec', async ({ request }) => {
    const health = await request.get(`${LIVE_URL}/api/health`);
    expect(health.status()).toBe(200);
    expect(health.headers()['content-type']).toBe('application/json');
    const levels = await request.get(`${LIVE_URL}/api/levels`);
    expect(levels.status()).toBe(200);
    expect((await levels.json()).levels).toHaveLength(10);
    const unknown = await request.get(`${LIVE_URL}/api/levels/0`);
    expect(unknown.status()).toBe(404);
    expect(typeof (await unknown.json()).error).toBe('string');
    const wrongMethod = await request.delete(`${LIVE_URL}/api/levels`);
    expect(wrongMethod.status()).toBe(405);
    expect(wrongMethod.headers()['allow']).toBe('GET');
    const emptyChecks = await request.post(`${LIVE_URL}/api/levels/1/result`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ checks: [] }),
    });
    expect(emptyChecks.status()).toBe(400);
    const wrongType = await request.post(`${LIVE_URL}/api/levels/1/result`, {
      headers: { 'Content-Type': 'text/plain' },
      data: JSON.stringify({ checks: [] }),
    });
    expect(wrongType.status()).toBe(415);
  });

  test('Meldung erscheint live ohne Neuladen', async ({ page, request }) => {
    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 20000 });
    const response = await request.post(`${LIVE_URL}/api/levels/1/result`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ checks: [{ name: 'Live-Probe', ok: true }], durationMs: 4242 }),
    });
    expect(response.status()).toBe(200);
    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card.getByTestId('level-duration')).toHaveText('4,2 s', { timeout: 8000 });
    const history = await request.get(`${LIVE_URL}/api/levels/1/history?limit=1`);
    expect(history.status()).toBe(200);
    const body = await history.json();
    expect(body.entries[0].checks).toContainEqual({ name: 'Live-Probe', ok: true });
  });

  test('Lasttest: 10 Verbindungen, 30 s, ohne Fehler, p95 unter 1 s', async () => {
    const result = await loadtest(LIVE_URL);
    const outputDirectory = path.join(process.cwd(), '.out');
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(path.join(outputDirectory, 'loadtest.json'), `${JSON.stringify(result)}\n`);
    expect(result.requests).toBeGreaterThan(0);
    expect(result.errors).toBe(0);
    expect(result.p95Ms).toBeLessThan(1000);
  });
});
