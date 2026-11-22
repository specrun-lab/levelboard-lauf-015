import { formatDateTime, reachedLevel, STATUS_LABELS, type Results } from '../results';

interface SummaryProps {
  results: Results;
}

export default function Summary({ results }: SummaryProps) {
  const reached = reachedLevel(results);

  return (
    <section className="summary" aria-label="Zusammenfassung">
      <div className="summary-left">
        <div className="summary-label">Erreichtes Level</div>
        <div className="summary-value" data-testid="summary-reached">
          {reached} <span className="summary-total">/ 10</span>
        </div>
      </div>
      <div className="summary-right">
        <div
          className="progress"
          role="img"
          aria-label={`${reached} von 10 Levels erreicht`}
          data-testid="summary-progress"
        >
          {results.levels.map((level) => (
            <span
              key={level.level}
              className={`progress-segment status-${level.status}`}
              title={`Level ${level.level}: ${STATUS_LABELS[level.status]}`}
            />
          ))}
        </div>
        <div className="summary-updated-row">
          Zuletzt aktualisiert:{' '}
          <span className="summary-updated" data-testid="summary-updated">
            {formatDateTime(results.run.updatedAt)}
          </span>
        </div>
      </div>
    </section>
  );
}
