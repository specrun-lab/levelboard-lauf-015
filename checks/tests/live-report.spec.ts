import { expect, test } from '@playwright/test';

const LIVE_URL = (process.env.LIVE_URL || '').replace(/\/$/, '');

test.setTimeout(120_000);

function formatSeconds(value: number): string {
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')} min`;
}

test.describe('live-bericht', () => {
  test('Live-Seite zeigt den gemeldeten Abschlussbericht', async ({ page, request }) => {
    const response = await request.get(`${LIVE_URL}/api/levels`);
    expect(response.status()).toBe(200);
    const results = await response.json();
    expect(results.levels).toHaveLength(10);
    for (const level of results.levels) {
      expect(level.status).toBe('bestanden');
      expect(level.metrics.build).toBeTruthy();
    }
    expect(results.levels[5].metrics.pipeline).toBeTruthy();
    expect(results.levels[6].metrics.images).toBeTruthy();
    expect(results.levels[8].metrics.loadtest).toBeTruthy();

    const buildTotal = results.levels.reduce(
      (sum: number, level: any) =>
        sum + (typeof level.metrics.build.buildS === 'number' ? level.metrics.build.buildS : 0),
      0,
    );
    const commitShort = String(results.run.commit).slice(0, 7);

    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 20000 });
    await expect(page.getByTestId('report')).toHaveAttribute('data-complete', 'true');
    await expect(page.getByTestId('summary-reached')).toHaveText('10 / 10');
    await expect(page.getByTestId('report-score')).toHaveText('100 / 100');
    await expect(page.getByTestId('report-commit')).toHaveText(commitShort);
    await expect(page.getByTestId('report-build-time')).toHaveText(formatSeconds(buildTotal));
    await expect(page.getByTestId('report-p95')).toHaveText(
      `${results.levels[8].metrics.loadtest.p95Ms} ms`,
    );
    await expect(page.getByTestId('report-image-backend')).toHaveText(
      `${results.levels[6].metrics.images.backendMB.toFixed(1).replace('.', ',')} MB`,
    );
    await expect(page.getByTestId('report-pipeline-total')).toHaveText(
      formatSeconds(results.levels[5].metrics.pipeline.totalS),
    );
    await expect(page.getByTestId('report-level')).toHaveCount(10);
    await expect(page.locator('[data-testid="report-level"][data-status="bestanden"]')).toHaveCount(10);
  });
});
