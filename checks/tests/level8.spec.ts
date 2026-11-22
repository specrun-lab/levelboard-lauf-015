import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const projectRoot = path.resolve(process.cwd(), '..');
const GITHUB_REPO = process.env.GITHUB_REPO || '';
const LIVE_URL = (process.env.LIVE_URL || '').replace(/\/$/, '');
const RUN_ID = process.env.RUN_ID || '';

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

function gitHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
}

test.describe('level-8', () => {
  test('Job deploy des letzten Laufs ist grün', async () => {
    const runs = JSON.parse(
      execFileSync(
        'gh',
        [
          'api',
          `repos/${GITHUB_REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${gitHead()}&per_page=1`,
        ],
        { encoding: 'utf8' },
      ),
    );
    const run = runs.workflow_runs?.[0];
    expect(run).toBeTruthy();
    const jobs = JSON.parse(
      execFileSync('gh', ['api', `repos/${GITHUB_REPO}/actions/runs/${run.id}/jobs?per_page=100`], {
        encoding: 'utf8',
      }),
    );
    const deploy = (jobs.jobs ?? []).find((job: { name: string }) => job.name === 'deploy');
    expect(deploy).toBeTruthy();
    expect(deploy.conclusion).toBe('success');
  });

  test('Live-Seite antwortet über HTTPS', async ({ page, request }) => {
    expect(LIVE_URL.startsWith('https://')).toBe(true);
    const response = await request.get(`${LIVE_URL}/`);
    expect(response.status()).toBe(200);
    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 20000 });
    await expect(page.getByTestId('run-source')).toHaveAttribute('data-source', 'api');
  });

  test('Live-Seite meldet den aktuellen Commit', async ({ page, request }) => {
    const head = gitHead();
    const response = await request.get(`${LIVE_URL}/api/health`);
    expect(response.status()).toBe(200);
    expect((await response.json()).commit).toBe(head);
    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('run-commit')).toHaveText(head.slice(0, 7), { timeout: 20000 });
  });

  test('Live-Seite zeigt die Ergebnisse der Pipeline', async ({ request }) => {
    const response = await request.get(`${LIVE_URL}/api/levels`);
    expect(response.status()).toBe(200);
    const results = await response.json();
    expect(results.run.id).toBe(RUN_ID);
    for (let level = 1; level <= 5; level += 1) {
      expect(results.levels[level - 1].status).toBe('bestanden');
    }
  });
});
