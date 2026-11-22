import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateBauzeit } from './bauzeit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const playwrightPath = join(here, '.out', 'playwright.json');
const resultsPath = join(projectRoot, 'frontend', 'dist', 'results.json');
const loadtestPath = join(here, '.out', 'loadtest.json');
const TITLES = [
  'Statische Seite',
  'Webserver',
  'REST-Backend',
  'Datenbank',
  'Frontend + Backend',
  'Repo + CI',
  'Images in der Pipeline',
  'Deployment',
  'Live-Prüfung',
  'Metriken veröffentlicht',
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function collectSpecs(suite, title, output) {
  if (!suite || typeof suite !== 'object') return;
  if (suite.title === title) {
    for (const spec of suite.specs ?? []) output.push(spec);
  }
  for (const child of suite.suites ?? []) collectSpecs(child, title, output);
}

function levelReport(report, level) {
  const specs = [];
  for (const suite of report.suites ?? []) collectSpecs(suite, `level-${level}`, specs);
  if (specs.length === 0) return null;
  const checks = [];
  let duration = 0;
  for (const spec of specs) {
    const ok =
      spec.ok === true &&
      Array.isArray(spec.tests) &&
      spec.tests.length > 0 &&
      spec.tests.every((entry) => entry.status === 'expected' || entry.status === 'flaky');
    checks.push({ name: spec.title, ok });
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        if (typeof result.duration === 'number') duration += result.duration;
      }
    }
  }
  return { checks, durationMs: Math.round(duration) };
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

async function postLevel(baseUrl, level, label) {
  const body = {
    checks: level.checks,
    durationMs: level.durationMs,
    metrics: level.metrics,
  };
  let response;
  try {
    response = await fetch(`${baseUrl}/api/levels/${level.level}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.log(
      `Meldung ${label} für Level ${level.level} fehlgeschlagen: 0 ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
  const text = await response.text();
  if (response.status !== 200) {
    console.log(`Meldung ${label} für Level ${level.level} fehlgeschlagen: ${response.status} ${text}`);
    return false;
  }
  console.log(`Level ${level.level} ${label === 'an das Backend' ? 'an das Backend' : 'an die Live-API'} gemeldet`);
  return true;
}

async function reportAll(baseUrl, label, levels) {
  for (const level of levels) {
    if (level.status !== 'bestanden' && level.status !== 'fehlgeschlagen') return false;
    const ok = await postLevel(baseUrl, level, label);
    if (!ok) return false;
    if (level.status === 'fehlgeschlagen') return true;
  }
  return true;
}

async function main() {
  const requested = [...new Set(process.argv.slice(2).map((value) => Number(value)))]
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 10)
    .sort((a, b) => a - b);
  if (requested.length === 0) fail('Keine Levels angegeben.');

  if (!existsSync(playwrightPath)) fail(`Playwright-Report fehlt: ${playwrightPath}`);
  if (!existsSync(resultsPath)) fail(`Ergebnisdatei fehlt: ${resultsPath}`);

  let playwright;
  try {
    playwright = JSON.parse(readFileSync(playwrightPath, 'utf8'));
  } catch (error) {
    fail(`Playwright-Report nicht lesbar: ${error instanceof Error ? error.message : String(error)}`);
  }

  const reports = new Map();
  for (const level of requested) {
    const report = levelReport(playwright, level);
    if (!report) fail(`Keine Checks für Level ${level} im Playwright-Report gefunden.`);
    reports.set(level, report);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(resultsPath, 'utf8'));
  } catch (error) {
    fail(`Ergebnisdatei nicht lesbar: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!data || !Array.isArray(data.levels)) fail('Ergebnisdatei hat kein levels-Array.');

  const byLevel = (level) => data.levels.find((entry) => entry.level === level);
  const now = new Date().toISOString();
  const smallest = requested[0];
  const processed = new Set();
  let failed = false;

  for (const levelNumber of requested) {
    if (failed) break;
    const level = byLevel(levelNumber);
    if (!level) fail(`Level ${levelNumber} fehlt in der Ergebnisdatei.`);
    const { checks, durationMs } = reports.get(levelNumber);
    const ok = checks.length > 0 && checks.every((check) => check.ok);
    level.title = TITLES[levelNumber - 1];
    level.status = ok ? 'bestanden' : 'fehlgeschlagen';
    level.checkedAt = now;
    level.durationMs = durationMs;
    level.checks = checks;
    level.metrics = {};
    processed.add(levelNumber);
    if (!ok) failed = true;
  }

  for (const level of data.levels) {
    if (level.level > smallest && !processed.has(level.level)) {
      level.status = failed ? 'gesperrt' : 'offen';
      level.checkedAt = null;
      level.durationMs = null;
      level.checks = [];
      level.metrics = {};
    }
  }

  data.run.updatedAt = now;
  if (process.env.RUN_ID) data.run.id = process.env.RUN_ID;

  const buildLevels = updateBauzeit(data);
  for (const level of data.levels) {
    if (!processed.has(level.level)) continue;
    level.metrics = {};
    const build = buildLevels[String(level.level)];
    if (build) level.metrics.build = build;
  }

  const repo = process.env.GITHUB_REPO || '';
  const head = repo ? gitHead() : '';
  if (processed.has(6) && byLevel(6).status === 'bestanden') {
    try {
      const { pipelineOf } = await import('./collect-report.mjs');
      if (!repo || !head) throw new Error('GITHUB_REPO oder HEAD fehlt');
      byLevel(6).metrics.pipeline = await pipelineOf(repo, head);
    } catch (error) {
      console.log(`Kennzahl pipeline nicht ermittelbar: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (processed.has(7) && byLevel(7).status === 'bestanden') {
    try {
      const { imageSizeMB } = await import('./collect-report.mjs');
      if (!repo || !head) throw new Error('GITHUB_REPO oder HEAD fehlt');
      const frontendMB = await imageSizeMB(`${repo}-frontend`, head);
      const backendMB = await imageSizeMB(`${repo}-backend`, head);
      byLevel(7).metrics.images = { frontendMB, backendMB };
    } catch (error) {
      console.log(`Kennzahl images nicht ermittelbar: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (processed.has(9) && byLevel(9).status === 'bestanden' && existsSync(loadtestPath)) {
    try {
      byLevel(9).metrics.loadtest = JSON.parse(readFileSync(loadtestPath, 'utf8'));
    } catch (error) {
      console.log(`Kennzahl loadtest nicht ermittelbar: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  writeFileSync(resultsPath, `${JSON.stringify(data, null, 2)}\n`);

  for (const levelNumber of requested) {
    const level = byLevel(levelNumber);
    const suffix = level.checks.length > 0 ? ` (${level.checks.filter((check) => check.ok).length}/${level.checks.length} Checks)` : '';
    console.log(`Level ${levelNumber}: ${level.status}${suffix}`);
  }

  let reportFailed = false;
  if (process.env.REPORT_API === '1') {
    const apiUrl = process.env.API_URL || 'http://127.0.0.1:8081';
    const targets = requested.map((number) => byLevel(number));
    const ok = await reportAll(apiUrl, 'an das Backend', targets);
    if (!ok) reportFailed = true;
  }
  if (process.env.REPORT_LIVE === '1') {
    const liveUrl = (process.env.LIVE_URL || '').replace(/\/$/, '');
    if (!liveUrl) {
      console.log('Meldung an die Live-API fehlgeschlagen: LIVE_URL fehlt');
      reportFailed = true;
    } else {
      const targets = requested.map((number) => byLevel(number));
      const ok = await reportAll(liveUrl, 'an die Live-API', targets);
      if (!ok) reportFailed = true;
    }
  }

  process.exitCode = failed || reportFailed ? 1 : 0;
}

await main();
