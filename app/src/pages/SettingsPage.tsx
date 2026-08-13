import { useI18n } from '../i18n';
import { AppearanceSection } from './settings/AppearanceSection';
import { TargetsSection } from './settings/TargetsSection';
import { AiKeysSection } from './settings/AiKeysSection';
import { HealthSyncSection } from './settings/HealthSyncSection';
import { ConnectorSection } from './settings/ConnectorSection';
import { DataSection } from './settings/DataSection';

export function SettingsPage() {
  const { t } = useI18n();
  return (
    <section className="stack">
      <h1>{t('settings.title')}</h1>
      <AppearanceSection />
      <TargetsSection />
      <AiKeysSection />
      <HealthSyncSection />
      <ConnectorSection />
      <DataSection />
    </section>
  );
}
