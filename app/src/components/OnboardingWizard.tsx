import { useState } from 'react';
import { LOCALES, THEMES, type UpdateMe } from '@bodyatlas/shared';
import { useI18n, type MessageKey } from '../i18n';
import { useUpdateMe, type Me } from '../lib/useMe';

export function OnboardingWizard({ me }: { me: Me }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState(me.theme);
  const [locale, setLocale] = useState(me.locale);
  const [kcal, setKcal] = useState(me.targetKcal != null ? String(me.targetKcal) : '');
  const [protein, setProtein] = useState(me.targetProteinG != null ? String(me.targetProteinG) : '');
  const [fat, setFat] = useState(me.targetFatG != null ? String(me.targetFatG) : '');
  const [carbs, setCarbs] = useState(me.targetCarbsG != null ? String(me.targetCarbsG) : '');

  const update = useUpdateMe();

  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const finish = (withPrefs: boolean) => {
    const patch: UpdateMe = { onboarded: true };
    if (withPrefs) {
      patch.theme = theme;
      patch.locale = locale;
      patch.targetKcal = num(kcal);
      patch.targetProteinG = num(protein);
      patch.targetFatG = num(fat);
      patch.targetCarbsG = num(carbs);
    }
    update.mutate(patch);
  };

  const LAST = 3;
  return (
    <main className="onboarding-main stack">
      {step === 0 && (
        <>
          <h1>{t('onboarding.welcome')}</h1>
          <p className="muted">{t('onboarding.welcomeBody')}</p>
        </>
      )}
      {step === 1 && (
        <>
          <h2>{t('onboarding.prefsTitle')}</h2>
          <div className="field">
            <span className="label">{t('settings.theme')}</span>
            <div className="segmented" role="group" aria-label={t('settings.theme')} style={{ alignSelf: 'start' }}>
              {THEMES.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={theme === v}
                  onClick={() => setTheme(v)}
                >
                  {t(`settings.theme.${v}` as MessageKey)}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="label">{t('settings.language')}</span>
            <select
              className="input"
              aria-label={t('settings.language')}
              value={locale}
              onChange={(e) => setLocale(e.target.value as Me['locale'])}
            >
              {LOCALES.map((v) => (
                <option key={v} value={v}>
                  {t(`settings.language.${v}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {step === 2 && (
        <>
          <h2>{t('onboarding.targetsTitle')}</h2>
          <div className="row">
            <input
              className="input input-num"
              placeholder="kcal"
              inputMode="numeric"
              value={kcal}
              onChange={(e) => setKcal(e.target.value)}
            />
            <input
              className="input input-num"
              placeholder="P"
              inputMode="numeric"
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
            />
            <input
              className="input input-num"
              placeholder="F"
              inputMode="numeric"
              value={fat}
              onChange={(e) => setFat(e.target.value)}
            />
            <input
              className="input input-num"
              placeholder="C"
              inputMode="numeric"
              value={carbs}
              onChange={(e) => setCarbs(e.target.value)}
            />
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <h2>{t('onboarding.timezoneTitle')}</h2>
          <p className="muted">{me.timezone}</p>
        </>
      )}
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={update.isPending}
          onClick={() => (step < LAST ? setStep(step + 1) : finish(true))}
        >
          {step < LAST ? t('onboarding.next') : t('onboarding.finish')}
        </button>
        <button type="button" className="btn" disabled={update.isPending} onClick={() => finish(false)}>
          {t('onboarding.skip')}
        </button>
      </div>
    </main>
  );
}
