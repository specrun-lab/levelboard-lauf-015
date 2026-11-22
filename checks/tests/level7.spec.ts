import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const projectRoot = path.resolve(process.cwd(), '..');
const GITHUB_REPO = process.env.GITHUB_REPO || '';

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

function gitHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
}

function latestRun(head: string): any {
  const runs = JSON.parse(
    execFileSync(
      'gh',
      ['api', `repos/${GITHUB_REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${head}&per_page=1`],
      { encoding: 'utf8' },
    ),
  );
  const run = runs.workflow_runs?.[0];
  if (!run) throw new Error('Kein CI-Lauf gefunden');
  return run;
}

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

async function publicManifest(name: string, tag: string): Promise<number> {
  const tokenResponse = await fetch(
    `https://ghcr.io/token?scope=${encodeURIComponent(`repository:${name}:pull`)}`,
  );
  expect(tokenResponse.ok).toBe(true);
  const token = (await tokenResponse.json()).token;
  expect(typeof token).toBe('string');
  const response = await fetch(`https://ghcr.io/v2/${name}/manifests/${tag}`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT },
  });
  return response.status;
}

function collectSpecs(suite: any, output: any[]): void {
  if (!suite || typeof suite !== 'object') return;
  for (const spec of suite.specs ?? []) output.push(spec);
  for (const child of suite.suites ?? []) collectSpecs(child, output);
}

test.describe('level-7', () => {
  test('Job images des letzten Laufs ist grün', async () => {
    const run = latestRun(gitHead());
    const jobs = JSON.parse(
      execFileSync('gh', ['api', `repos/${GITHUB_REPO}/actions/runs/${run.id}/jobs?per_page=100`], {
        encoding: 'utf8',
      }),
    );
    const images = (jobs.jobs ?? []).find((job: { name: string }) => job.name === 'images');
    expect(images).toBeTruthy();
    expect(images.conclusion).toBe('success');
  });

  test('Beide Images liegen öffentlich in der GHCR', async () => {
    const head = gitHead();
    for (const part of ['frontend', 'backend']) {
      const status = await publicManifest(`${GITHUB_REPO}-${part}`, head);
      expect(status).toBeGreaterThanOrEqual(200);
      expect(status).toBeLessThan(300);
    }
  });

  test('Report der Container-Suite enthält nur bestandene Checks', async () => {
    const run = latestRun(gitHead());
    const directory = mkdtempSync(path.join(os.tmpdir(), 'levelboard-container-'));
    try {
      execFileSync(
        'gh',
        [
          'run',
          'download',
          String(run.id),
          '--repo',
          GITHUB_REPO,
          '--name',
          'levelboard-container-report',
          '--dir',
          directory,
        ],
        { stdio: 'pipe' },
      );
      const files = readdirSync(directory, { recursive: true, encoding: 'utf8' }) as string[];
      const reportFile = files.find((file) => file.endsWith('playwright.json'));
      expect(reportFile).toBeTruthy();
      const report = JSON.parse(readFileSync(path.join(directory, reportFile as string), 'utf8'));
      const specs: any[] = [];
      for (const suite of report.suites ?? []) collectSpecs(suite, specs);
      expect(specs.length).toBeGreaterThanOrEqual(6);
      for (const spec of specs) {
        expect(spec.ok).toBe(true);
        for (const entry of spec.tests ?? []) {
          expect(['expected', 'flaky']).toContain(entry.status);
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
