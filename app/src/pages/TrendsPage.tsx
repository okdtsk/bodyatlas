import { useI18n } from '../i18n';

export function TrendsPage() {
  const { t } = useI18n();
  return (
    <section>
      <h1>{t('nav.trends')}</h1>
      <p style={{ color: 'var(--text-muted)' }}>{t('trends.placeholder')}</p>
    </section>
  );
}
