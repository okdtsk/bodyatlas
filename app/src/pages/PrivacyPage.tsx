import { Link } from 'react-router';
import { useI18n } from '../i18n';

export function PrivacyPage() {
  const { t } = useI18n();
  return (
    <main className="stack" style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--sp-5)', lineHeight: 'var(--lh-normal)' }}>
      <h1>{t('privacy.title')}</h1>
      <p>{t('privacy.intro')}</p>
      <h2>{t('privacy.dataTitle')}</h2>
      <p>{t('privacy.dataBody')}</p>
      <h2>{t('privacy.storageTitle')}</h2>
      <p>{t('privacy.storageBody')}</p>
      <h2>{t('privacy.rightsTitle')}</h2>
      <p>{t('privacy.rightsBody')}</p>
      <h2>{t('privacy.sharingTitle')}</h2>
      <p>{t('privacy.sharingBody')}</p>
      <p>{t('privacy.contact')}</p>
      <Link className="muted" to="/">{t('privacy.back')}</Link>
    </main>
  );
}
