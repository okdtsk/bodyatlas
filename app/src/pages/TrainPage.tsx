import { useI18n } from '../i18n';

export function TrainPage() {
  const { t } = useI18n();
  return (
    <section>
      <h1>{t('nav.train')}</h1>
      <p style={{ color: 'var(--text-muted)' }}>{t('train.placeholder')}</p>
    </section>
  );
}
