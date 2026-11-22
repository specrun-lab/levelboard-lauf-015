import { readFileSync } from 'node:fs';

async function main() {
  const [file, baseArgument] = process.argv.slice(2);
  if (!file || !baseArgument) {
    console.error('Aufruf: node report-live.mjs <results.json> <basis-url>');
    process.exit(1);
  }
  const base = baseArgument.replace(/\/$/, '');
  const results = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(results.levels)) {
    console.error('Ergebnisdatei hat kein levels-Array.');
    process.exit(1);
  }

  const levels = [...results.levels].sort((a, b) => a.level - b.level);
  let reported = 0;
  for (const level of levels) {
    if (level.status !== 'bestanden' && level.status !== 'fehlgeschlagen') break;
    if (!Array.isArray(level.checks) || level.checks.length === 0) break;
    const body = {
      checks: level.checks,
      durationMs: level.durationMs,
      metrics: level.metrics ?? {},
    };
    const response = await fetch(`${base}/api/levels/${level.level}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error(`Meldung an die Live-API für Level ${level.level} fehlgeschlagen: ${response.status} ${text}`);
      process.exit(1);
    }
    reported += 1;
    console.log(`Level ${level.level} an die Live-API gemeldet`);
    if (level.status === 'fehlgeschlagen') break;
  }

  if (reported === 0) {
    console.error('Keine Level gemeldet.');
    process.exit(1);
  }
}

await main();
