import type { DataSource, RunInfo } from '../results';

interface HeaderProps {
  run: RunInfo;
  source: DataSource | null;
}

export default function Header({ run, source }: HeaderProps) {
  const commitShort = run.commit ? run.commit.slice(0, 7) : '–';
  const sourceText = source === 'api' ? 'Backend' : source === 'file' ? 'Datei' : '–';

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          ▮▮▮
        </span>
        <span className="brand-name">Levelboard</span>
      </div>
      <dl className="header-facts">
        <div className="header-fact">
          <dt>Durchlauf</dt>
          <dd data-testid="run-id">{run.id}</dd>
        </div>
        <div className="header-fact">
          <dt>Version</dt>
          <dd data-testid="run-version">{run.version}</dd>
        </div>
        <div className="header-fact header-commit">
          <dt>Commit</dt>
          <dd data-testid="run-commit" title={run.commit ?? undefined}>
            {commitShort}
          </dd>
        </div>
        <div className="header-fact header-source">
          <dt>Quelle</dt>
          <dd data-testid="run-source" data-source={source ?? ''}>
            {sourceText}
          </dd>
        </div>
      </dl>
    </header>
  );
}
