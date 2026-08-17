import { useI18n } from '../../i18n';
import { useMe, useUpdateMe } from '../../lib/useMe';

export function TargetsSection() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const update = useUpdateMe();

  if (!me) return null;

  return (
    <section className="panel stack">
      <h2 className="label">{t('settings.targets')}</h2>
      {(
        [
          { key: 'targetKcal', label: t('settings.targetKcal') },
          { key: 'targetProteinG', label: t('settings.targetProtein') },
          { key: 'targetFatG', label: t('settings.targetFat') },
          { key: 'targetCarbsG', label: t('settings.targetCarbs') },
        ] as const
      ).map(({ key, label }) => (
        <label key={key} className="field">
          <span className="label">{label}</span>
          <input
            aria-label={label}
            className="input input-num"
            inputMode="numeric"
            defaultValue={me[key] ?? ''}
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

      {update.isSuccess && <p style={{ color: 'var(--positive)' }}>{t('settings.saved')}</p>}
      {update.isError && <p style={{ color: 'var(--negative)' }}>{t('error.generic')}</p>}
    </section>
  );
}
