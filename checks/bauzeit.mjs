import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const bauzeitPath = join(projectRoot, 'bauzeit.json');

function nowIso() {
  return new Date().toISOString();
}

function formatFile(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function readBauzeit() {
  try {
    const parsed = JSON.parse(readFileSync(bauzeitPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (!parsed.levels || typeof parsed.levels !== 'object' || Array.isArray(parsed.levels)) {
        parsed.levels = {};
      }
      return parsed;
    }
  } catch {
    // Fehlende oder kaputte Datei wird neu angelegt.
  }
  return { start: nowIso(), levels: {} };
}

export function reachedFromResults(results) {
  let reached = 0;
  for (const level of results.levels) {
    if (level.level !== reached + 1) break;
    if (level.status !== 'bestanden') break;
    reached = level.level;
  }
  return reached;
}

export function updateBauzeit(results, options = {}) {
  const fixed = options.fixed ?? process.env.BAUZEIT_FEST === '1';
  const data = readBauzeit();
  if (typeof data.start !== 'string' || Number.isNaN(Date.parse(data.start))) {
    data.start = nowIso();
  }

  const reached = reachedFromResults(results);
  let bisher = 0;
  for (let level = 1; level <= 10; level += 1) {
    if (!data.levels[String(level)]) break;
    bisher = level;
  }

  if (!fixed && reached > bisher) {
    const now = nowIso();
    const previous = data.levels[String(bisher)];
    const since = previous && typeof previous.passedAt === 'string' ? previous.passedAt : data.start;
    const sinceMs = Date.parse(since);
    const buildS = Number.isNaN(sinceMs)
      ? 0
      : Math.max(0, Math.round((Date.parse(now) - sinceMs) / 1000));
    data.levels[String(reached)] = { passedAt: now, buildS };
    for (let level = bisher + 1; level < reached; level += 1) {
      data.levels[String(level)] = { passedAt: now, inLevel: reached };
    }
  }

  if (!fixed) {
    writeFileSync(bauzeitPath, formatFile(data));
  }
  return data.levels;
}
