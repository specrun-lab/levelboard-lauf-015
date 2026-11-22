import { useEffect, useState } from 'react';
import Header from './components/Header';
import LevelCard from './components/LevelCard';
import Notice from './components/Notice';
import Report from './components/Report';
import Summary from './components/Summary';
import {
  emptyResults,
  validateResults,
  validateUsage,
  type DataSource,
  type LoadState,
  type Results,
  type Usage,
} from './results';

function isHtmlResponse(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

export default function App() {
  const [source, setSource] = useState<DataSource | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<Results>(() => emptyResults());
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    const loadFile = async () => {
      let response: Response;
      try {
        response = await fetch('/results.json', { cache: 'no-store' });
      } catch {
        if (!cancelled) {
          setState('missing');
          setData(emptyResults());
        }
        return;
      }
      if (cancelled) return;
      if (response.status === 404 || (response.ok && isHtmlResponse(response))) {
        setState('missing');
        setData(emptyResults());
        return;
      }
      if (!response.ok) {
        setState('invalid');
        setData(emptyResults());
        return;
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        if (!cancelled) {
          setState('invalid');
          setData(emptyResults());
        }
        return;
      }
      if (cancelled) return;
      const valid = validateResults(parsed);
      if (!valid) {
        setState('invalid');
        setData(emptyResults());
        return;
      }
      setData(valid);
      setState('ok');
    };

    const loadUsage = async (): Promise<Usage | null> => {
      try {
        const response = await fetch('/api/usage', { cache: 'no-store' });
        if (!response.ok || isHtmlResponse(response)) return null;
        const parsed: unknown = await response.json();
        return validateUsage(parsed);
      } catch {
        return null;
      }
    };

    const apiOnce = async () => {
      const usagePromise = loadUsage();
      let response: Response;
      try {
        response = await fetch('/api/levels', { cache: 'no-store' });
      } catch {
        await usagePromise;
        if (!cancelled) {
          setState('unavailable');
          setData(emptyResults());
          setUsage(null);
        }
        return;
      }
      const nextUsage = await usagePromise;
      if (cancelled) return;

      if (!response.ok || isHtmlResponse(response)) {
        setState('unavailable');
        setData(emptyResults());
        setUsage(null);
        return;
      }

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        if (!cancelled) {
          setState('invalid');
          setData(emptyResults());
          setUsage(null);
        }
        return;
      }
      if (cancelled) return;
      const valid = validateResults(parsed);
      if (!valid) {
        setState('invalid');
        setData(emptyResults());
        setUsage(null);
        return;
      }
      setData(valid);
      setState('ok');
      setUsage(nextUsage);
    };

    const runApi = async () => {
      while (!cancelled) {
        await apiOnce();
        if (cancelled) break;
        await sleep(5000);
      }
    };

    const init = async () => {
      let mode: DataSource = 'file';
      try {
        const response = await fetch('/config.json', { cache: 'no-store' });
        if (response.ok && !isHtmlResponse(response)) {
          const parsed: unknown = await response.json();
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            !Array.isArray(parsed) &&
            (parsed as Record<string, unknown>).source === 'api'
          ) {
            mode = 'api';
          }
        }
      } catch {
        mode = 'file';
      }
      if (cancelled) return;
      setSource(mode);
      if (mode === 'api') {
        await runApi();
      } else {
        await loadFile();
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="app" data-testid="board" data-state={state}>
      <Header run={data.run} source={source} />
      <main className="main">
        {(state === 'missing' || state === 'invalid' || state === 'unavailable') && <Notice kind={state} />}
        <Summary results={data} />
        <section className="grid" aria-label="Levels">
          {data.levels.map((level) => (
            <LevelCard key={level.level} level={level} />
          ))}
        </section>
        <Report results={data} usage={usage} />
      </main>
    </div>
  );
}
