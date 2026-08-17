import { useI18n } from '../../i18n';

export function ConnectorSection() {
  const { t } = useI18n();

  return (
    <section className="panel stack">
      <h2 className="label">{t('settings.connect')}</h2>
      <p className="muted">{t('settings.connectHint')}</p>
      <code
        style={{
          display: 'block',
          wordBreak: 'break-all',
          padding: 'var(--sp-2)',
          background: 'var(--surface-2)',
          borderRadius: 'var(--radius)',
        }}
      >
        https://bodyatlas.okdtsk.dev/mcp
      </code>
      <p className="muted">{t('settings.connectDocs')}</p>
    </section>
  );
}
