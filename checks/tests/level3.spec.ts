import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://127.0.0.1:8081';
const projectRoot = path.resolve(process.cwd(), '..');

function postResult(request: import('@playwright/test').APIRequestContext, level: number, body: unknown) {
  return request.post(`${API_URL}/api/levels/${level}/result`, {
    headers: { 'Content-Type': 'application/json' },
    data: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('level-3', () => {
  test('Backend antwortet auf /api/health', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/health`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/json');
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['commit', 'status', 'version']);
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.commit).toBeNull();
  });

  test('GET /api/levels liefert alle 10 Levels im Schema', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/levels`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['levels', 'run']);
    expect(body.levels).toHaveLength(10);
    body.levels.forEach((level: Record<string, unknown>, index: number) => {
      expect(level.level).toBe(index + 1);
      expect(['offen', 'bestanden', 'fehlgeschlagen', 'gesperrt']).toContain(level.status);
      expect(Array.isArray(level.checks)).toBe(true);
    });
  });

  test('Ergebnis melden setzt Status und Zeitpunkt', async ({ request }) => {
    const response = await postResult(request, 1, {
      checks: [{ name: 'Probe', ok: true }],
      durationMs: 10,
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    const level = body.levels.find((entry: { level: number }) => entry.level === 1);
    expect(level.status).toBe('bestanden');
    expect(Date.parse(level.checkedAt)).not.toBeNaN();
    expect(level.durationMs).toBe(10);
  });

  test('Fehlschlag sperrt höhere Levels', async ({ request }) => {
    const response = await postResult(request, 1, {
      checks: [{ name: 'Probe', ok: false }],
      durationMs: 10,
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.levels[0].status).toBe('fehlgeschlagen');
    for (const level of body.levels.slice(1)) {
      expect(level.status).toBe('gesperrt');
    }
  });

  test('Falsche Reihenfolge ergibt 409', async ({ request }) => {
    const response = await postResult(request, 2, {
      checks: [{ name: 'Probe', ok: true }],
      durationMs: 10,
    });
    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  test('Ungültige Anfragen ergeben 400', async ({ request }) => {
    const bodies = ['{kaputt', '{"durationMs":1}', '{"checks":[],"durationMs":1}'];
    for (const body of bodies) {
      const response = await postResult(request, 1, body);
      expect(response.status()).toBe(400);
      const parsed = await response.json();
      expect(typeof parsed.error).toBe('string');
    }
  });

  test('Unbekanntes Level ergibt 404', async ({ request }) => {
    for (const segment of ['0', '11', 'abc']) {
      const response = await request.get(`${API_URL}/api/levels/${segment}`);
      expect(response.status()).toBe(404);
    }
  });

  test('Go-Tests bestehen', async () => {
    expect(() =>
      execFileSync('go', ['test', '-count=1', './...'], {
        cwd: path.join(projectRoot, 'backend'),
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
