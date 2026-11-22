import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { imageSizeMB, pipelineOf } from '../collect-report.mjs';

const projectRoot = path.resolve(process.cwd(), '..');
const GITHUB_REPO = process.env.GITHUB_REPO || '';
const LIVE_URL = (process.env.LIVE_URL || '').replace(/\/$/, '');
const API_URL = process.env.API_URL || 'http://127.0.0.1:8081';
const outputDirectory = path.join(process.cwd(), '.out');
const berichtPath = path.join(outputDirectory, 'bericht.json');

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

function gitHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
}

function formatSeconds(value: number): string {
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')} min`;
}

function formatMB(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} MB`;
}

function formatTokens(value: number): string {
  return value.toLocaleString('de-CH');
}

function formatCost(value: number | null): string {
  if (value === null) return '–';
  return `${value.toFixed(2).replace('.', ',')} USD`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function buildText(entry: { buildS?: number; inLevel?: number }): string {
  if (typeof entry.inLevel === 'number') return `in L${pad2(entry.inLevel)}`;
  return formatSeconds(entry.buildS ?? 0);
}

function readBericht(): {
  pipeline: any;
  images: { frontendMB: number; backendMB: number };
  loadtest: any;
  build: Record<string, { buildS?: number; inLevel?: number; passedAt?: string }>;
} {
  return JSON.parse(readFileSync(berichtPath, 'utf8'));
}

test.describe('level-10', () => {
  test('Alle Teile des Berichts sind vorhanden', async () => {
    const head = gitHead();
    const pipeline = await pipelineOf(GITHUB_REPO, head);
    for (const job of ['check', 'images', 'deploy']) {
      expect(pipeline.jobs[job]).toBeGreaterThan(0);
    }
    const frontendMB = await imageSizeMB(`${GITHUB_REPO}-frontend`, head);
    const backendMB = await imageSizeMB(`${GITHUB_REPO}-backend`, head);
    expect(frontendMB).toBeGreaterThan(0);
    expect(backendMB).toBeGreaterThan(0);

    const loadtestFile = path.join(outputDirectory, 'loadtest.json');
    expect(existsSync(loadtestFile)).toBe(true);
    const loadtest = JSON.parse(readFileSync(loadtestFile, 'utf8'));
    expect(loadtest.requests).toBeGreaterThan(0);

    let stored: any = { levels: {} };
    const bauzeitFile = path.join(projectRoot, 'bauzeit.json');
    if (existsSync(bauzeitFile)) {
      stored = JSON.parse(readFileSync(bauzeitFile, 'utf8'));
    }
    const build: Record<string, unknown> = {};
    for (let level = 1; level <= 10; level += 1) {
      build[String(level)] =
        stored.levels?.[String(level)] ?? { passedAt: new Date().toISOString(), buildS: 42 + level };
    }

    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(
      berichtPath,
      `${JSON.stringify({ pipeline, images: { frontendMB, backendMB }, loadtest, build }, null, 2)}\n`,
    );
  });

  test('Vollständiger Bericht wird dargestellt', async ({ page, request }) => {
    const bericht = readBericht();
    const real = await (await request.get(`${LIVE_URL}/api/levels`)).json();
    const now = new Date().toISOString();
    const levels = real.levels.map((level: any) => ({
      ...level,
      status: 'bestanden',
      checkedAt: now,
      durationMs: 1000,
      checks: [{ name: 'Bericht-Probe', ok: true }],
      metrics: { build: bericht.build[String(level.level)] },
    }));
    levels[5].metrics.pipeline = bericht.pipeline;
    levels[6].metrics.images = bericht.images;
    levels[8].metrics.loadtest = bericht.loadtest;

    const usage = {
      harness: 'pruefer-harness',
      models: ['modell-a', 'modell-b'],
      measuredAt: now,
      total: { output: 812345, total: 23456789, costUsd: 2.04 },
      levels: Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => {
          const level = index + 1;
          const entry = bericht.build[String(level)];
          if (typeof entry?.inLevel === 'number') {
            return [String(level), { inLevel: entry.inLevel }];
          }
          return [String(level), { output: level * 1000 + 7, total: level * 10000, costUsd: level / 10 }];
        }),
      ),
    };

    await page.route('**/api/levels', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ run: real.run, levels }),
      }),
    );
    await page.route('**/api/usage', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(usage) }),
    );
    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 20000 });

    const report = page.getByTestId('report');
    await expect(report).toHaveAttribute('data-complete', 'true');
    await expect(page.getByTestId('report-reached')).toHaveText('10 / 10');
    await expect(page.getByTestId('report-complete')).toHaveText('ja');

    const totalBuild = Object.values(bericht.build).reduce(
      (sum, entry) => sum + (typeof entry.buildS === 'number' ? entry.buildS : 0),
      0,
    );
    await expect(page.getByTestId('report-build-time')).toHaveText(formatSeconds(totalBuild));
    await expect(page.getByTestId('report-p95')).toHaveText(`${bericht.loadtest.p95Ms} ms`);
    await expect(page.getByTestId('report-image-frontend')).toHaveText(formatMB(bericht.images.frontendMB));
    for (const job of ['check', 'images', 'deploy']) {
      await expect(page.getByTestId(`report-job-${job}`)).toHaveText(formatSeconds(bericht.pipeline.jobs[job]));
    }
    await expect(page.getByTestId('report-pipeline-total')).toHaveText(formatSeconds(bericht.pipeline.totalS));
    await expect(page.getByTestId('report-pipeline-link')).toHaveAttribute('href', bericht.pipeline.url);

    for (let level = 1; level <= 10; level += 1) {
      const card = page.locator(`[data-testid="level-card"][data-level="${level}"]`);
      await expect(card.getByTestId('level-build-time')).toHaveText(buildText(bericht.build[String(level)]));
    }

    await expect(page.getByTestId('report-harness')).toHaveText('pruefer-harness');
    await expect(page.getByTestId('report-model')).toHaveText('modell-a, modell-b');
    await expect(page.getByTestId('report-tokens-output')).toHaveText(formatTokens(812345));
    await expect(page.getByTestId('report-tokens-total')).toHaveText(formatTokens(23456789));
    await expect(page.getByTestId('report-cost')).toHaveText('2,04 USD');

    for (let level = 1; level <= 10; level += 1) {
      const row = page.locator(`[data-testid="report-level"][data-level="${level}"]`);
      const entry = usage.levels[String(level)];
      if ('inLevel' in entry) {
        await expect(row.getByTestId('report-level-cost')).toHaveText(`in L${pad2(entry.inLevel)}`);
        await expect(row.getByTestId('report-level-output')).toHaveText(`in L${pad2(entry.inLevel)}`);
      } else {
        await expect(row.getByTestId('report-level-cost')).toHaveText(formatCost(entry.costUsd));
        await expect(row.getByTestId('report-level-output')).toHaveText(formatTokens(entry.output));
      }
    }
  });

  test('Teilbericht zeigt fehlende Teile', async ({ page, request }) => {
    const real = await (await request.get(`${LIVE_URL}/api/levels`)).json();
    const now = new Date().toISOString();
    const levels = real.levels.map((level: any) =>
      level.level <= 2
        ? {
            ...level,
            status: 'bestanden',
            checkedAt: now,
            durationMs: 42,
            checks: [{ name: 'Teil-Probe', ok: true }],
            metrics: { build: { passedAt: now, buildS: 42 } },
          }
        : {
            ...level,
            status: 'offen',
            checkedAt: null,
            durationMs: null,
            checks: [],
            metrics: {},
          },
    );

    await page.route('**/api/levels', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ run: real.run, levels }),
      }),
    );
    await page.route('**/api/usage', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 20000 });

    await expect(page.getByTestId('report')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('report')).toHaveAttribute('data-complete', 'false');
    await expect(page.getByTestId('report-reached')).toHaveText('2 / 10');
    await expect(page.getByTestId('report-complete')).toHaveText('nein');
    await expect(page.getByTestId('report-build-time')).toHaveText('1:24 min');
    await expect(page.getByTestId('report-pipeline-missing')).toHaveText('noch nicht erreicht');
    await expect(page.getByTestId('report-images-missing')).toHaveText('noch nicht erreicht');
    await expect(page.getByTestId('report-loadtest-missing')).toHaveText('noch nicht erreicht');
    await expect(page.getByTestId('report-tokens-missing')).toHaveText('wird nach der Prüfung ergänzt');
    for (let level = 1; level <= 10; level += 1) {
      const row = page.locator(`[data-testid="report-level"][data-level="${level}"]`);
      await expect(row.getByTestId('report-level-cost')).toHaveText('–');
      await expect(row.getByTestId('report-level-output')).toHaveText('–');
    }
  });

  test('Verbrauch wird gespeichert und gelesen', async ({ request }) => {
    const previous = await (await request.get(`${API_URL}/api/usage`)).json();
    const example = {
      harness: 'probe-harness',
      models: ['probe-modell'],
      measuredAt: new Date().toISOString(),
      total: { output: 1234, total: 5678, costUsd: 1.23 },
      levels: { '1': { output: 10, total: 20, costUsd: 0.01 }, '2': { inLevel: 3 } },
    };
    try {
      const saved = await request.put(`${API_URL}/api/usage`, {
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(example),
      });
      expect(saved.status()).toBe(200);
      expect(await saved.json()).toEqual(example);
      expect(await (await request.get(`${API_URL}/api/usage`)).json()).toEqual(example);

      for (const body of ['[1,2]', '{kaputt']) {
        const response = await request.put(`${API_URL}/api/usage`, {
          headers: { 'Content-Type': 'application/json' },
          data: body,
        });
        expect(response.status()).toBe(400);
      }
      const wrongType = await request.put(`${API_URL}/api/usage`, {
        headers: { 'Content-Type': 'text/plain' },
        data: JSON.stringify(example),
      });
      expect(wrongType.status()).toBe(415);
      const tooLarge = await request.put(`${API_URL}/api/usage`, {
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ blob: 'x'.repeat(70000) }),
      });
      expect(tooLarge.status()).toBe(413);
      const wrongMethod = await request.post(`${API_URL}/api/usage`, {
        headers: { 'Content-Type': 'application/json' },
        data: '{}',
      });
      expect(wrongMethod.status()).toBe(405);
      expect(wrongMethod.headers()['allow']).toContain('PUT');

      expect(await (await request.get(`${API_URL}/api/usage`)).json()).toEqual(example);
      const cleared = await request.put(`${API_URL}/api/usage`, {
        headers: { 'Content-Type': 'application/json' },
        data: '{}',
      });
      expect(cleared.status()).toBe(200);
      expect(await (await request.get(`${API_URL}/api/usage`)).json()).toEqual({});
    } finally {
      await request.put(`${API_URL}/api/usage`, {
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(previous),
      });
    }
  });
});
