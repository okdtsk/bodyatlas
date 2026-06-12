import { useI18n } from '../i18n';

export function TodayPage() {
  const { t } = useI18n();
  return (
    <section>
      <h1>{t('nav.today')}</h1>
      <p style={{ color: 'var(--text-muted)' }}>{t('today.placeholder')}</p>
    </section>
  );
}
