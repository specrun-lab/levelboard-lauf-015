import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const projectRoot = path.resolve(process.cwd(), '..');
const GITHUB_REPO = process.env.GITHUB_REPO || '';

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

function ghJSON(argument: string): any {
  return JSON.parse(execFileSync('gh', ['api', argument], { encoding: 'utf8' }));
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim();
}

function latestRun(head: string): any {
  const runs = ghJSON(
    `repos/${GITHUB_REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${head}&per_page=1`,
  );
  return runs.workflow_runs?.[0];
}

function findResults(directory: string): string | null {
  const candidates = [path.join(directory, 'results.json'), path.join(directory, 'frontend', 'dist', 'results.json')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

test.describe('level-6', () => {
  test('Repo existiert und ist öffentlich', async () => {
    const repo = ghJSON(`repos/${GITHUB_REPO}`);
    expect(repo.full_name).toBe(GITHUB_REPO);
    expect(repo.visibility).toBe('public');
    expect(repo.default_branch).toBe('main');
  });

  test('Lokaler Stand ist gepusht', async () => {
    expect(git(['status', '--porcelain'])).toBe('');
    const head = git(['rev-parse', 'HEAD']);
    const branch = ghJSON(`repos/${GITHUB_REPO}/branches/main`);
    expect(branch.commit.sha).toBe(head);
  });

  test('Letzter Pipeline-Lauf ist grün', async () => {
    const head = git(['rev-parse', 'HEAD']);
    const run = latestRun(head);
    expect(run).toBeTruthy();
    expect(run.status).toBe('completed');
    expect(run.conclusion).toBe('success');
  });

  test('Report enthält Level 1–5 bestanden', async () => {
    const head = git(['rev-parse', 'HEAD']);
    const run = latestRun(head);
    expect(run).toBeTruthy();
    const directory = mkdtempSync(path.join(os.tmpdir(), 'levelboard-artifact-'));
    try {
      execFileSync(
        'gh',
        ['run', 'download', String(run.id), '--repo', GITHUB_REPO, '--name', 'levelboard-report', '--dir', directory],
        { stdio: 'pipe' },
      );
      const resultsPath = findResults(directory);
      expect(resultsPath).not.toBeNull();
      const results = JSON.parse(readFileSync(resultsPath as string, 'utf8'));
      for (let level = 1; level <= 5; level += 1) {
        const entry = results.levels.find((item: { level: number }) => item.level === level);
        expect(entry.status).toBe('bestanden');
        expect(entry.checks.length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
