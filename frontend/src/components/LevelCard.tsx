import {
  formatBuild,
  formatChecks,
  formatDateTime,
  formatDuration,
  LEVEL_TITLES,
  STATUS_LABELS,
  type LevelResult,
} from '../results';

interface LevelCardProps {
  level: LevelResult;
}

export default function LevelCard({ level }: LevelCardProps) {
  const title = LEVEL_TITLES[level.level - 1];

  return (
    <article
      className={`level-card status-${level.status}${level.status === 'gesperrt' ? ' is-locked' : ''}`}
      data-testid="level-card"
      data-level={level.level}
      data-status={level.status}
    >
      <div className="level-card-head">
        <span className="level-number">L{String(level.level).padStart(2, '0')}</span>
        <span className="level-badge" data-testid="level-status">
          <span className="level-badge-dot" aria-hidden="true" />
          {STATUS_LABELS[level.status]}
        </span>
      </div>
      <h2 className="level-title" data-testid="level-title">
        {title}
      </h2>
      <dl className="level-facts">
        <div className="level-fact">
          <dt>Geprüft</dt>
          <dd data-testid="level-checked-at">{formatDateTime(level.checkedAt)}</dd>
        </div>
        <div className="level-fact">
          <dt>Checkdauer</dt>
          <dd data-testid="level-duration">{formatDuration(level.durationMs)}</dd>
        </div>
        <div className="level-fact">
          <dt>Checks</dt>
          <dd data-testid="level-checks">{formatChecks(level.checks)}</dd>
        </div>
        <div className="level-fact">
          <dt>Bauzeit</dt>
          <dd data-testid="level-build-time">{formatBuild(level.metrics.build)}</dd>
        </div>
      </dl>
    </article>
  );
}
