import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LOCALES, THEMES, type UpdateMe } from '@bodyatlas/shared';
import { useI18n, type MessageKey } from '../i18n';
import { api } from '../lib/api';
import { useMe } from '../lib/useMe';

export function SettingsPage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: async (patch: UpdateMe) => {
      const res = await api.me.$patch({ json: patch });
      if (!res.ok) throw new Error(`PATCH /api/me failed: ${res.status}`);
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['me'], updated);
    },
  });

  if (!me) return null;

  const fieldStyle = {
    display: 'block',
    width: '100%',
    maxWidth: 320,
    padding: 10,
    marginTop: 6,
    background: 'var(--surface-2)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
  } as const;

  return (
    <section>
      <h1>{t('settings.title')}</h1>

      <label style={{ display: 'block', marginBottom: 16 }}>
        {t('settings.theme')}
        <select
          aria-label={t('settings.theme')}
          style={fieldStyle}
          value={me.theme}
          onChange={(e) => update.mutate({ theme: e.target.value as UpdateMe['theme'] })}
        >
          {THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {t(`settings.theme.${theme}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block', marginBottom: 16 }}>
        {t('settings.language')}
        <select
          aria-label={t('settings.language')}
          style={fieldStyle}
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

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>{t('settings.targets')}</h2>
        {(
          [
            { key: 'targetKcal', label: t('settings.targetKcal') },
            { key: 'targetProteinG', label: t('settings.targetProtein') },
            { key: 'targetFatG', label: t('settings.targetFat') },
            { key: 'targetCarbsG', label: t('settings.targetCarbs') },
          ] as const
        ).map(({ key, label }) => (
          <label key={key} style={{ display: 'block', marginBottom: 12 }}>
            {label}
            <input
              aria-label={label}
              className="input input-num"
              inputMode="numeric"
              defaultValue={me[key] ?? ''}
              style={{ ...fieldStyle, maxWidth: 160 }}
              onBlur={(e) => {
                const parsed = Math.round(parseFloat(e.target.value));
                const next = Number.isNaN(parsed) ? null : parsed;
                // Normalize the display so it matches the saved value.
                e.target.value = next === null ? '' : String(next);
                const prev = me[key] ?? null;
                if (next !== prev) {
                  update.mutate({ [key]: next });
                }
              }}
            />
          </label>
        ))}
      </section>

      {update.isSuccess && (
        <p style={{ color: 'var(--positive)' }}>{t('settings.saved')}</p>
      )}
      {update.isError && (
        <p style={{ color: 'var(--negative)' }}>{t('error.generic')}</p>
      )}

      <form method="post" action="/auth/logout">
        <button
          type="submit"
          style={{
            marginTop: 24,
            padding: '10px 20px',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
          }}
        >
          {t('settings.signOut')}
        </button>
      </form>
    </section>
  );
}
