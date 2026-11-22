import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://127.0.0.1:8081';
const projectRoot = path.resolve(process.cwd(), '..');

function postResult(
  request: import('@playwright/test').APIRequestContext,
  level: number,
  ok: boolean,
  durationMs: number,
) {
  return request.post(`${API_URL}/api/levels/${level}/result`, {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ checks: [{ name: `Probe ${level}`, ok }], durationMs }),
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('level-4', () => {
  test('Meldungen erscheinen in der Historie, neueste zuerst', async ({ request }) => {
    expect((await postResult(request, 1, true, 101)).status()).toBe(200);
    expect((await postResult(request, 1, true, 102)).status()).toBe(200);
    const response = await request.get(`${API_URL}/api/levels/1/history`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.level).toBe(1);
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    expect(body.entries[0].durationMs).toBe(102);
    expect(body.entries[1].durationMs).toBe(101);
    expect(body.entries[0].id).toBeGreaterThan(body.entries[1].id);
    expect(body.entries[0].status).toBe('bestanden');
  });

  test('Historie begrenzt mit limit', async ({ request }) => {
    const limited = await request.get(`${API_URL}/api/levels/1/history?limit=1`);
    expect(limited.status()).toBe(200);
    expect((await limited.json()).entries).toHaveLength(1);
    for (const limit of ['0', '501']) {
      const response = await request.get(`${API_URL}/api/levels/1/history?limit=${limit}`);
      expect(response.status()).toBe(400);
    }
  });

  test('Daten überstehen einen Neustart des Backends', async ({ request }) => {
    const historyBefore = await (await request.get(`${API_URL}/api/levels/1/history?limit=500`)).json();
    const levelsBefore = await (await request.get(`${API_URL}/api/levels`)).json();
    execFileSync('make', ['restart-backend'], { cwd: projectRoot, stdio: 'pipe' });
    const historyAfter = await (await request.get(`${API_URL}/api/levels/1/history?limit=500`)).json();
    const levelsAfter = await (await request.get(`${API_URL}/api/levels`)).json();
    expect(historyAfter).toEqual(historyBefore);
    expect(levelsAfter).toEqual(levelsBefore);
  });

  test('Abgelehnte Meldungen landen nicht in der Historie', async ({ request }) => {
    const before = await (await request.get(`${API_URL}/api/levels/2/history?limit=500`)).json();
    expect((await postResult(request, 1, false, 50)).status()).toBe(200);
    expect((await postResult(request, 2, true, 50)).status()).toBe(409);
    const after = await (await request.get(`${API_URL}/api/levels/2/history?limit=500`)).json();
    expect(after.entries.length).toBe(before.entries.length);
  });

  test('Datenbank hat das vorgegebene Schema', async () => {
    const database = new DatabaseSync(path.join(projectRoot, '.run', 'levelboard.db'), { readOnly: true });
    try {
      const version = database.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(version.user_version).toBe(1);

      const expected: Record<string, Array<[string, string]>> = {
        levels: [
          ['level', 'INTEGER'],
          ['status', 'TEXT'],
          ['checked_at', 'TEXT'],
          ['duration_ms', 'INTEGER'],
          ['checks', 'TEXT'],
          ['metrics', 'TEXT'],
        ],
        reports: [
          ['id', 'INTEGER'],
          ['level', 'INTEGER'],
          ['status', 'TEXT'],
          ['checked_at', 'TEXT'],
          ['duration_ms', 'INTEGER'],
          ['checks', 'TEXT'],
          ['metrics', 'TEXT'],
        ],
        meta: [
          ['key', 'TEXT'],
          ['value', 'TEXT'],
        ],
      };

      for (const [table, columns] of Object.entries(expected)) {
        const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string }>;
        expect(rows.map((row) => [row.name, row.type])).toEqual(columns);
      }

      const count = database.prepare('SELECT COUNT(*) AS count FROM levels').get() as { count: number };
      expect(count.count).toBe(10);
    } finally {
      database.close();
    }
  });
});
