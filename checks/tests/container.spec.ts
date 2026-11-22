import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const projectRoot = path.resolve(process.cwd(), '..');

function firstScriptPath(html: string): string {
  const match = html.match(/<script[^>]+src="([^"]+\.js)"/);
  if (!match) throw new Error('Keine JS-Datei in index.html gefunden');
  return match[1];
}

test.describe.configure({ mode: 'serial' });

test.describe('container', () => {
  test('Seite läuft im Container und liest aus dem Backend', async ({ page, request }) => {
    const config = await request.get('/config.json');
    expect(await config.json()).toEqual({ source: 'api' });
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 12000 });
    await expect(page.getByTestId('run-source')).toHaveAttribute('data-source', 'api');
  });

  test('/api/ wird an den Backend-Container weitergeleitet', async ({ request }) => {
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(health.headers()['content-type']).toBe('application/json');
    expect((await health.json()).status).toBe('ok');
    const missing = await request.get('/api/unbekannt');
    expect(missing.status()).toBe(404);
  });

  test('Meldung erscheint ohne Neuladen', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 12000 });
    const response = await request.post('/api/levels/1/result', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ checks: [{ name: 'Container-Probe', ok: true }], durationMs: 4242 }),
    });
    expect(response.status()).toBe(200);
    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card.getByTestId('level-duration')).toHaveText('4,2 s', { timeout: 8000 });
  });

  test('Daten überstehen einen Neustart des Backend-Containers', async ({ request }) => {
    const before = await (await request.get('/api/levels/1/history?limit=500')).json();
    expect(before.entries.length).toBeGreaterThan(0);
    execFileSync('docker', ['compose', 'restart', 'backend'], { cwd: projectRoot, stdio: 'pipe' });
    await expect
      .poll(
        async () => {
          try {
            return (await request.get('/api/health')).status();
          } catch {
            return 0;
          }
        },
        { timeout: 60000, intervals: [1000] },
      )
      .toBe(200);
    const after = await (await request.get('/api/levels/1/history?limit=500')).json();
    expect(after).toEqual(before);
  });

  test('Cache- und gzip-Regeln gelten im Container', async ({ request }) => {
    const index = await request.get('/', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(index.headers()['cache-control']).toBe('no-cache');
    expect(index.headers()['content-encoding']).toBe('gzip');
    expect(index.headers()['server']).toBe('nginx');
    const script = firstScriptPath(await index.text());
    const asset = await request.get(script);
    expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    const config = await request.get('/config.json');
    expect(config.headers()['cache-control']).toBe('no-store');
    const missing = await request.get('/gibt-es-nicht.json');
    expect(missing.status()).toBe(404);
  });

  test('Backend-Container läuft nicht als root', async () => {
    const uid = execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'id', '-u'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    expect(uid).not.toBe('0');
  });
});
