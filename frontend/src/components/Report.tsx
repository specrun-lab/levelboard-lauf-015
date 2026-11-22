import {
  asNumber,
  formatBuild,
  formatCost,
  formatDateTime,
  formatMB,
  formatRps,
  formatSeconds,
  formatTokens,
  isComplete,
  isInLevel,
  levelHasData,
  LEVEL_TITLES,
  metricObject,
  reachedLevel,
  totalBuildSeconds,
  usageHarnessText,
  usageLevel,
  usageModelText,
  type ImagesMetric,
  type LevelResult,
  type LoadtestMetric,
  type PipelineMetric,
  type Results,
  type Usage,
} from '../results';

interface ReportProps {
  results: Results;
  usage: Usage | null;
}

function findLevel(results: Results, level: number): LevelResult | undefined {
  return results.levels.find((entry) => entry.level === level);
}

function jobSeconds(value: unknown): string {
  const seconds = asNumber(value);
  return seconds === null ? '–' : formatSeconds(seconds);
}

function msText(value: unknown): string {
  const milliseconds = asNumber(value);
  return milliseconds === null ? '–' : `${milliseconds} ms`;
}

export default function Report({ results, usage }: ReportProps) {
  const ready = levelHasData(results);
  const complete = isComplete(results);
  const reached = reachedLevel(results);
  const buildTotal = totalBuildSeconds(results.levels);
  const commit = results.run.commit ? results.run.commit.slice(0, 7) : '–';

  const loadtest: LoadtestMetric | null = metricObject(findLevel(results, 9)?.metrics.loadtest);
  const images: ImagesMetric | null = metricObject(findLevel(results, 7)?.metrics.images);
  const pipeline: PipelineMetric | null = metricObject(findLevel(results, 6)?.metrics.pipeline);

  return (
    <section
      className="report"
      aria-label="Abschlussbericht"
      data-testid="report"
      data-state={ready ? 'ready' : 'empty'}
      data-complete={complete ? 'true' : 'false'}
    >
      <h2 className="report-title">Abschlussbericht</h2>
      {!ready ? (
        <p className="report-empty" data-testid="report-empty">
          Noch kein Abschlussbericht – er erscheint, sobald das erste Level geprüft ist.
        </p>
      ) : (
        <>
          <div className="report-tiles">
            <div className="report-tile">
              <h3>Ergebnis</h3>
              <dl>
                <div className="report-fact">
                  <dt>Erreicht</dt>
                  <dd data-testid="report-reached">{reached} / 10</dd>
                </div>
                <div className="report-fact">
                  <dt>Score</dt>
                  <dd data-testid="report-score">{reached * 10} / 100</dd>
                </div>
                <div className="report-fact">
                  <dt>Vollständig</dt>
                  <dd data-testid="report-complete">{complete ? 'ja' : 'nein'}</dd>
                </div>
                <div className="report-fact">
                  <dt>Bauzeit gesamt</dt>
                  <dd data-testid="report-build-time">
                    {buildTotal === null ? '–' : formatBuild({ buildS: buildTotal })}
                  </dd>
                </div>
                <div className="report-fact">
                  <dt>Commit</dt>
                  <dd data-testid="report-commit">{commit}</dd>
                </div>
                <div className="report-fact">
                  <dt>Stand</dt>
                  <dd data-testid="report-time">{formatDateTime(results.run.updatedAt)}</dd>
                </div>
              </dl>
            </div>

            <div className="report-tile">
              <h3>Tokens</h3>
              {!usage ? (
                <p className="report-missing" data-testid="report-tokens-missing">
                  wird nach der Prüfung ergänzt
                </p>
              ) : (
                <dl>
                  <div className="report-fact">
                    <dt>Harness</dt>
                    <dd data-testid="report-harness">{usageHarnessText(usage)}</dd>
                  </div>
                  <div className="report-fact">
                    <dt>Modell</dt>
                    <dd data-testid="report-model">{usageModelText(usage)}</dd>
                  </div>
                  <div className="report-fact">
                    <dt>Tokens (Ausgabe)</dt>
                    <dd data-testid="report-tokens-output">{formatTokens(usage.total.output)}</dd>
                  </div>
                  <div className="report-fact">
                    <dt>Tokens gesamt</dt>
                    <dd data-testid="report-tokens-total">{formatTokens(usage.total.total)}</dd>
                  </div>
                  <div className="report-fact">
                    <dt>Kosten gesamt</dt>
                    <dd data-testid="report-cost">{formatCost(usage.total.costUsd)}</dd>
                  </div>
                </dl>
              )}
            </div>

            <div className="report-tile">
              <h3>Lasttest</h3>
              {!loadtest ? (
                <p className="report-missing" data-testid="report-loadtest-missing">
                  noch nicht erreicht
                </p>
              ) : (
                <dl>
                  <div className="report-fact">
                    <dt>p50</dt>
                    <dd data-testid="report-p50">{msText(loadtest.p50Ms)}</dd>
                  </div>
                  <div className="report-fact">
                    <dt>p95</dt>
                    <dd data-testid="report-p95">{msText(loadtest.p95Ms)}</dd>
                  </div>
                  <div className="report-fact">
                    <dt>Durchsatz</dt>
                    <dd data-testid="report-rps">{formatRps(asNumber(loadtest.rps))}</dd>
                  </div>
                  <div className="report-fact">
                    <dt>Fehler</dt>
                    <dd data-testid="report-errors">{asNumber(loadtest.errors) ?? '–'}</dd>
                  </div>
                </dl>
              )}
            </div>

            <div className="report-tile">
              <h3>Images</h3>
              {!images ? (
                <p className="report-missing" data-testid="report-images-missing">
                  noch nicht erreicht
                </p>
              ) : (
                <dl>
                  <div className="report-fact">
                    <dt>Frontend</dt>
                    <dd data-testid="report-image-frontend">{formatMB(asNumber(images.frontendMB))}</dd>
                  </div>
                  <div className="report-fact">
                    <dt>Backend</dt>
                    <dd data-testid="report-image-backend">{formatMB(asNumber(images.backendMB))}</dd>
                  </div>
                </dl>
              )}
            </div>

            <div className="report-tile">
              <h3>Pipeline</h3>
              {!pipeline ? (
                <p className="report-missing" data-testid="report-pipeline-missing">
                  noch nicht erreicht
                </p>
              ) : (
                <>
                  <dl>
                    <div className="report-fact">
                      <dt>check</dt>
                      <dd data-testid="report-job-check">{jobSeconds(pipeline.jobs?.check)}</dd>
                    </div>
                    <div className="report-fact">
                      <dt>images</dt>
                      <dd data-testid="report-job-images">{jobSeconds(pipeline.jobs?.images)}</dd>
                    </div>
                    <div className="report-fact">
                      <dt>deploy</dt>
                      <dd data-testid="report-job-deploy">{jobSeconds(pipeline.jobs?.deploy)}</dd>
                    </div>
                    <div className="report-fact">
                      <dt>Gesamt</dt>
                      <dd data-testid="report-pipeline-total">{jobSeconds(pipeline.totalS)}</dd>
                    </div>
                  </dl>
                  {typeof pipeline.url === 'string' && pipeline.url.length > 0 && (
                    <a
                      className="report-link"
                      data-testid="report-pipeline-link"
                      href={pipeline.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Lauf ansehen
                    </a>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="report-list">
            <div className="report-list-head" aria-hidden="true">
              <span>Level</span>
              <span>Status</span>
              <span>Kosten</span>
              <span>Tokens (Ausgabe)</span>
              <span>Geprüft</span>
            </div>
            <ol className="report-levels" data-testid="report-levels">
              {results.levels.map((level) => {
                const entry = usageLevel(usage, level.level);
                let cost = '–';
                let output = '–';
                if (entry) {
                  if (isInLevel(entry)) {
                    cost = `in L${String(entry.inLevel).padStart(2, '0')}`;
                    output = `in L${String(entry.inLevel).padStart(2, '0')}`;
                  } else {
                    cost = formatCost(entry.costUsd);
                    output = formatTokens(entry.output);
                  }
                }
                return (
                  <li
                    key={level.level}
                    className="report-level"
                    data-testid="report-level"
                    data-level={level.level}
                    data-status={level.status}
                  >
                    <span className="report-level-title">
                      L{String(level.level).padStart(2, '0')} {LEVEL_TITLES[level.level - 1]}
                    </span>
                    <span className={`report-level-status status-${level.status}`}>
                      {level.status === 'bestanden'
                        ? 'Bestanden'
                        : level.status === 'fehlgeschlagen'
                          ? 'Fehlgeschlagen'
                          : level.status === 'gesperrt'
                            ? 'Gesperrt'
                            : 'Offen'}
                    </span>
                    <span className="report-level-cost" data-testid="report-level-cost">
                      {cost}
                    </span>
                    <span className="report-level-output" data-testid="report-level-output">
                      {output}
                    </span>
                    <span className="report-level-time">{formatDateTime(level.checkedAt)}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
