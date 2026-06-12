import { useI18n } from '../i18n';

export function SettingsPage() {
  const { t } = useI18n();
  return <h1>{t('settings.title')}</h1>;
}
