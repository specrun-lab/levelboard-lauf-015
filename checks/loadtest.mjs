import { pathToFileURL } from 'node:url';

export async function loadtest(base) {
  const root = base.replace(/\/$/, '');
  const start = performance.now();
  const durationMs = 30_000;
  const times = [];
  let errors = 0;

  async function loop() {
    let target = '/';
    while (performance.now() - start < durationMs) {
      const requestStart = performance.now();
      let failed = false;
      try {
        const response = await fetch(`${root}${target}`, { signal: AbortSignal.timeout(10_000) });
        await response.text();
        if (response.status !== 200) failed = true;
      } catch {
        failed = true;
      }
      times.push(performance.now() - requestStart);
      if (failed) errors += 1;
      target = target === '/' ? '/api/levels' : '/';
    }
  }

  await Promise.all(Array.from({ length: 10 }, () => loop()));
  const elapsedSeconds = (performance.now() - start) / 1000;
  const sorted = [...times].sort((a, b) => a - b);
  const nearestRank = (percent) => {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((percent / 100) * sorted.length);
    return Math.round(sorted[Math.min(sorted.length, Math.max(1, index)) - 1]);
  };

  return {
    connections: 10,
    durationS: 30,
    requests: times.length,
    errors,
    rps: Math.round((times.length / elapsedSeconds) * 10) / 10,
    p50Ms: nearestRank(50),
    p95Ms: nearestRank(95),
    maxMs: Math.round(sorted.length > 0 ? sorted[sorted.length - 1] : 0),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2];
  if (!base) {
    console.error('Aufruf: node loadtest.mjs <basis-url>');
    process.exit(1);
  }
  const result = await loadtest(base);
  console.log(JSON.stringify(result));
}
