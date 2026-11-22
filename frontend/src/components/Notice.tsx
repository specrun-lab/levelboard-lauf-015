export type NoticeKind = 'missing' | 'invalid' | 'unavailable';

const MESSAGES: Record<NoticeKind, string> = {
  missing: 'Keine Ergebnisse gefunden. Die Datei results.json fehlt.',
  invalid: 'Die Ergebnisdatei ist ungültig. Es werden keine Ergebnisse angezeigt.',
  unavailable: 'Backend nicht erreichbar. Neuer Versuch alle 5 Sekunden.',
};

interface NoticeProps {
  kind: NoticeKind;
}

export default function Notice({ kind }: NoticeProps) {
  return (
    <div className="notice" role="alert" data-testid="notice" data-kind={kind}>
      <span className="notice-icon" aria-hidden="true">
        !
      </span>
      <span>{MESSAGES[kind]}</span>
    </div>
  );
}
