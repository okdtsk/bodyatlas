import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateMe } from '@bodyatlas/shared';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import type { Me } from '../lib/useMe';

export function OnboardingWizard({ me }: { me: Me }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState(me.theme);
  const [locale, setLocale] = useState(me.locale);
  const [kcal, setKcal] = useState(me.targetKcal != null ? String(me.targetKcal) : '');
  const [protein, setProtein] = useState(me.targetProteinG != null ? String(me.targetProteinG) : '');
  const [fat, setFat] = useState(me.targetFatG != null ? String(me.targetFatG) : '');
  const [carbs, setCarbs] = useState(me.targetCarbsG != null ? String(me.targetCarbsG) : '');

  const update = useMutation({
    mutationFn: async (patch: UpdateMe) => {
      const res = await api.me.$patch({ json: patch });
      if (!res.ok) throw new Error(`PATCH /api/me failed: ${res.status}`);
      return res.json();
    },
    onSuccess: (updated) => {
      qc.setQueryData(['me'], updated);
    },
  });

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
    <main
      style={{
        maxWidth: 440,
        margin: '0 auto',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {step === 0 && (
        <>
          <h1>{t('onboarding.welcome')}</h1>
          <p>{t('onboarding.welcomeBody')}</p>
        </>
      )}
      {step === 1 && (
        <>
          <h2>{t('onboarding.prefsTitle')}</h2>
          <label>
            {t('settings.theme')}
            <select value={theme} onChange={(e) => setTheme(e.target.value as Me['theme'])}>
              <option value="gym-dark">Gym Dark</option>
              <option value="clinical-light">Clinical Light</option>
              <option value="warm-journal">Warm Journal</option>
            </select>
          </label>
          <label>
            {t('settings.language')}
            <select value={locale} onChange={(e) => setLocale(e.target.value as Me['locale'])}>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </label>
        </>
      )}
      {step === 2 && (
        <>
          <h2>{t('onboarding.targetsTitle')}</h2>
          <input
            placeholder="kcal"
            inputMode="numeric"
            value={kcal}
            onChange={(e) => setKcal(e.target.value)}
          />
          <input
            placeholder="P"
            inputMode="numeric"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
          />
          <input
            placeholder="F"
            inputMode="numeric"
            value={fat}
            onChange={(e) => setFat(e.target.value)}
          />
          <input
            placeholder="C"
            inputMode="numeric"
            value={carbs}
            onChange={(e) => setCarbs(e.target.value)}
          />
        </>
      )}
      {step === 3 && (
        <>
          <h2>{t('onboarding.timezoneTitle')}</h2>
          <p>{me.timezone}</p>
        </>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={update.isPending}
          onClick={() => (step < LAST ? setStep(step + 1) : finish(true))}
        >
          {step < LAST ? t('onboarding.next') : t('onboarding.finish')}
        </button>
        <button type="button" disabled={update.isPending} onClick={() => finish(false)}>
          {t('onboarding.skip')}
        </button>
      </div>
    </main>
  );
}
