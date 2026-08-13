import { LOCALES, THEMES, type Theme, type UpdateMe } from '@bodyatlas/shared';
import { useI18n, type MessageKey } from '../../i18n';
import { useMe, useUpdateMe } from '../../lib/useMe';
import { applyTheme } from '../../theme/ThemeProvider';

export function AppearanceSection() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const update = useUpdateMe();

  if (!me) return null;

  function setTheme(theme: Theme) {
    applyTheme(theme); // paint immediately; the mutation persists it
    update.mutate({ theme });
  }

  return (
    <section className="panel stack">
      <h2 className="label">{t('settings.appearance')}</h2>

      <div className="field">
        <span className="label">{t('settings.theme')}</span>
        <div className="segmented" role="group" aria-label={t('settings.theme')} style={{ alignSelf: 'start' }}>
          {THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              aria-pressed={me.theme === theme}
              onClick={() => setTheme(theme)}
            >
              {t(`settings.theme.${theme}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="label">{t('settings.language')}</span>
        <select
          aria-label={t('settings.language')}
          className="input"
          value={me.locale}
          onChange={(e) => update.mutate({ locale: e.target.value as UpdateMe['locale'] })}
        >
          {LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {t(`settings.language.${locale}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>

      {update.isSuccess && <p style={{ color: 'var(--positive)' }}>{t('settings.saved')}</p>}
      {update.isError && <p style={{ color: 'var(--negative)' }}>{t('error.generic')}</p>}
    </section>
  );
}
