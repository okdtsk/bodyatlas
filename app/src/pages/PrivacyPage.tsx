import { Link } from 'react-router';
import { useI18n } from '../i18n';

export function PrivacyPage() {
  const { t } = useI18n();
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24, lineHeight: 1.6 }}>
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
      <p style={{ marginTop: 24 }}>{t('privacy.contact')}</p>
      <Link to="/">{t('privacy.back')}</Link>
    </main>
  );
}
