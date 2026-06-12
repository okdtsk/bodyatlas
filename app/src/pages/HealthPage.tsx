import { useI18n } from '../i18n';

export function HealthPage() {
  const { t } = useI18n();
  return (
    <section>
      <h1>{t('nav.health')}</h1>
      <p style={{ color: 'var(--text-muted)' }}>{t('health.placeholder')}</p>
    </section>
  );
}
