export type LevelStatus = 'offen' | 'bestanden' | 'fehlgeschlagen' | 'gesperrt';

export interface CheckResult {
  name: string;
  ok: boolean;
}

export interface LevelResult {
  level: number;
  title: string;
  status: LevelStatus;
  checkedAt: string | null;
  durationMs: number | null;
  checks: CheckResult[];
  metrics: Record<string, unknown>;
}

export interface RunInfo {
  id: string;
  version: string;
  commit: string | null;
  updatedAt: string | null;
}

export interface Results {
  run: RunInfo;
  levels: LevelResult[];
}

export interface BuildMetric {
  passedAt?: string;
  buildS?: number;
  inLevel?: number;
}

export interface LoadtestMetric {
  connections?: number;
  durationS?: number;
  requests?: number;
  errors?: number;
  rps?: number;
  p50Ms?: number;
  p95Ms?: number;
  maxMs?: number;
}

export interface ImagesMetric {
  frontendMB?: number;
  backendMB?: number;
}

export interface PipelineMetric {
  runId?: number;
  url?: string;
  jobs?: Record<string, number>;
  totalS?: number;
}

export interface UsageNumbers {
  output: number;
  total: number;
  costUsd: number | null;
}

export interface UsageLevelInLevel {
  inLevel: number;
}

export type UsageLevel = UsageNumbers | UsageLevelInLevel;

export interface Usage {
  harness?: unknown;
  models?: unknown;
  measuredAt?: unknown;
  total: UsageNumbers;
  levels?: Record<string, unknown>;
}

export type LoadState = 'loading' | 'ok' | 'missing' | 'invalid' | 'unavailable';
export type DataSource = 'file' | 'api';

export const LEVEL_TITLES = [
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
] as const;

export const STATUS_LABELS: Record<LevelStatus, string> = {
  offen: 'Offen',
  bestanden: 'Bestanden',
  fehlgeschlagen: 'Fehlgeschlagen',
  gesperrt: 'Gesperrt',
};

export function emptyResults(): Results {
  return {
    run: { id: '–', version: '–', commit: null, updatedAt: null },
    levels: LEVEL_TITLES.map((title, index) => ({
      level: index + 1,
      title,
      status: 'offen' as LevelStatus,
      checkedAt: null,
      durationMs: null,
      checks: [],
      metrics: {},
    })),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validCheck(value: unknown): value is CheckResult {
  if (!isObject(value) || !hasExactKeys(value, ['name', 'ok'])) return false;
  return typeof value.name === 'string' && value.name.length > 0 && typeof value.ok === 'boolean';
}

function validLevel(value: unknown, expected: number): value is LevelResult {
  if (!isObject(value)) return false;
  if (!hasExactKeys(value, ['level', 'title', 'status', 'checkedAt', 'durationMs', 'checks', 'metrics'])) return false;
  if (value.level !== expected) return false;
  if (typeof value.title !== 'string') return false;
  if (
    value.status !== 'offen' &&
    value.status !== 'bestanden' &&
    value.status !== 'fehlgeschlagen' &&
    value.status !== 'gesperrt'
  ) {
    return false;
  }
  if (value.checkedAt !== null && !isDateString(value.checkedAt)) return false;
  if (value.durationMs !== null && (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 0)) {
    return false;
  }
  if (!Array.isArray(value.checks) || !value.checks.every(validCheck)) return false;
  if (!isObject(value.metrics)) return false;
  return true;
}

export function validateResults(value: unknown): Results | null {
  if (!isObject(value) || !hasExactKeys(value, ['run', 'levels'])) return null;
  const run = value.run;
  if (!isObject(run) || !hasExactKeys(run, ['id', 'version', 'commit', 'updatedAt'])) return null;
  if (typeof run.id !== 'string' || run.id.length === 0) return null;
  if (typeof run.version !== 'string' || run.version.length === 0) return null;
  if (run.commit !== null && typeof run.commit !== 'string') return null;
  if (run.updatedAt !== null && !isDateString(run.updatedAt)) return null;

  if (!Array.isArray(value.levels) || value.levels.length !== 10) return null;
  if (!value.levels.every((entry, index) => validLevel(entry, index + 1))) return null;

  return value as unknown as Results;
}

export function reachedLevel(results: Results): number {
  let reached = 0;
  for (const level of results.levels) {
    if (level.level !== reached + 1) break;
    if (level.status !== 'bestanden') break;
    reached = level.level;
  }
  return reached;
}

export function isComplete(results: Results): boolean {
  return results.levels.some((level) => level.level === 10 && level.status === 'bestanden');
}

export function levelHasData(results: Results): boolean {
  return results.levels.some((level) => level.checkedAt !== null);
}

export function numberOfLevels(results: Results): number {
  return results.levels.length;
}

const dateTimeFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return dateTimeFormat.format(date);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatSeconds(value: number): string {
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${pad2(seconds === 60 ? 0 : seconds)} min`;
}

export function buildMetric(value: unknown): BuildMetric | null {
  if (!isObject(value)) return null;
  const result: BuildMetric = {};
  if (typeof value.buildS === 'number') result.buildS = value.buildS;
  if (typeof value.inLevel === 'number') result.inLevel = value.inLevel;
  if (typeof value.passedAt === 'string') result.passedAt = value.passedAt;
  if (result.buildS === undefined && result.inLevel === undefined) return null;
  return result;
}

export function formatBuild(value: unknown): string {
  const metric = buildMetric(value);
  if (!metric) return '–';
  if (metric.inLevel !== undefined) return `in L${pad2(metric.inLevel)}`;
  if (metric.buildS !== undefined) return formatSeconds(metric.buildS);
  return '–';
}

export function totalBuildSeconds(levels: LevelResult[]): number | null {
  let total = 0;
  let found = false;
  for (const level of levels) {
    const metric = buildMetric(level.metrics.build);
    if (metric && metric.buildS !== undefined) {
      total += metric.buildS;
      found = true;
    }
  }
  return found ? total : null;
}

export function formatChecks(checks: CheckResult[]): string {
  if (checks.length === 0) return '–';
  const passed = checks.filter((check) => check.ok).length;
  return `${passed}/${checks.length}`;
}

export function formatTokens(value: number): string {
  return value.toLocaleString('de-CH');
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${value.toFixed(2).replace('.', ',')} USD`;
}

export function formatCostShort(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${value.toFixed(2).replace('.', ',')} USD`;
}

export function formatMB(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${value.toFixed(1).replace('.', ',')} MB`;
}

export function formatRps(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${value.toFixed(1).replace('.', ',')} Anfragen/s`;
}

export function metricObject(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validUsageNumbers(value: unknown): value is UsageNumbers {
  if (!isObject(value)) return false;
  if (!Number.isInteger(value.output) || (value.output as number) < 0) return false;
  if (!Number.isInteger(value.total) || (value.total as number) < 0) return false;
  if (value.costUsd !== null && typeof value.costUsd !== 'number') return false;
  return true;
}

export function validateUsage(value: unknown): Usage | null {
  if (!isObject(value)) return null;
  if (!validUsageNumbers(value.total)) return null;
  return value as unknown as Usage;
}

export function usageModelText(usage: Usage | null): string {
  if (!usage || !Array.isArray(usage.models)) return '–';
  const models = usage.models.filter((model): model is string => typeof model === 'string' && model.length > 0);
  return models.length > 0 ? models.join(', ') : '–';
}

export function usageHarnessText(usage: Usage | null): string {
  if (!usage || typeof usage.harness !== 'string' || usage.harness.length === 0) return '–';
  return usage.harness;
}

export function usageLevel(usage: Usage | null, level: number): UsageLevel | null {
  if (!usage || !isObject(usage.levels)) return null;
  const entry = usage.levels[String(level)];
  if (!isObject(entry)) return null;
  if (typeof entry.inLevel === 'number' && Number.isInteger(entry.inLevel)) {
    return { inLevel: entry.inLevel };
  }
  if (validUsageNumbers(entry)) {
    return { output: entry.output, total: entry.total, costUsd: entry.costUsd };
  }
  return null;
}

export function isInLevel(value: UsageLevel): value is UsageLevelInLevel {
  return 'inLevel' in value;
}
