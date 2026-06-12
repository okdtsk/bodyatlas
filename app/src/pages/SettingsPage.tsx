import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LOCALES, THEMES, type UpdateMe, AI_PROVIDERS, type AiProvider } from '@bodyatlas/shared';
import { useI18n, type MessageKey } from '../i18n';
import { api } from '../lib/api';
import { useCreateToken, useRevokeToken, useTokens, type CreatedToken } from '../lib/tokens';
import { useAiSettings, useSaveAiSettings, useDeleteAiSettings, useTestAi } from '../lib/ai';
import { useMe } from '../lib/useMe';
import { useCreateSleep, useCreateMeasurement, type SleepRecord, type Measurement } from '../lib/health';
import {
  isNativeShell,
  healthRequestAuth,
  healthQuerySamples,
  mergeMeasurementSamples,
  mergeSleepSamples,
  pickNewDays,
} from '../lib/native';
import { localDayKey } from '../lib/buckets';
import { addDays } from '../lib/format';

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

  const { data: tokens = [] } = useTokens();
  const createToken = useCreateToken();
  const revokeToken = useRevokeToken();

  const [newTokenName, setNewTokenName] = useState('');
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);

  // AI coach state
  const { data: aiSettings } = useAiSettings();
  const saveAiSettings = useSaveAiSettings();
  const deleteAiSettings = useDeleteAiSettings();
  const testAi = useTestAi();

  // Tracks user-defined model; undefined means "auto-default based on provider"
  const [aiProvider, setAiProvider] = useState<AiProvider | ''>('');
  const [aiModel, setAiModel] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiModelTouched, setAiModelTouched] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  // Apple Health state
  const [ahConnected, setAhConnected] = useState(false);
  const [ahConnecting, setAhConnecting] = useState(false);
  const [ahSyncing, setAhSyncing] = useState(false);
  const [ahResult, setAhResult] = useState<{ sleep: number; weight: number } | null>(null);
  const [ahFailed, setAhFailed] = useState(0);
  const [ahError, setAhError] = useState(false);
  const createSleep = useCreateSleep();
  const createMeasurement = useCreateMeasurement();

  function getDefaultModel(provider: AiProvider | ''): string {
    if (provider === 'claude') return 'claude-opus-4-8';
    return '';
  }

  function handleProviderChange(provider: AiProvider | '') {
    setAiProvider(provider);
    if (!aiModelTouched) {
      setAiModel(getDefaultModel(provider));
    }
  }

  async function handleAiSave() {
    if (!aiProvider || !aiModel) return;
    const input: { provider: AiProvider; model: string; apiKey?: string } = {
      provider: aiProvider,
      model: aiModel,
    };
    if (aiKey.trim()) {
      input.apiKey = aiKey.trim();
    }
    try {
      await saveAiSettings.mutateAsync(input);
      setAiKey('');
      setTestStatus('idle');
    } catch {
      // error handled by mutation state
    }
  }

  async function handleAiTest() {
    setTestStatus('idle');
    try {
      await testAi.mutateAsync();
      setTestStatus('ok');
    } catch {
      setTestStatus('error');
    }
  }

  async function handleAiDisconnect() {
    if (!window.confirm(t('ai.disconnect') + '?')) return;
    try {
      await deleteAiSettings.mutateAsync();
      setAiProvider('');
      setAiModel('');
      setAiKey('');
      setAiModelTouched(false);
      setTestStatus('idle');
    } catch {
      // error handled by mutation state
    }
  }

  // Initialize form from stored settings when loaded
  const currentProvider = (aiSettings as { provider?: AiProvider | null } | undefined)?.provider;
  const currentModel = (aiSettings as { model?: string } | undefined)?.model;
  const hasKey = (aiSettings as { hasKey?: boolean } | undefined)?.hasKey ?? false;

  // Sync provider/model from server settings on first load (if form is empty)
  if (currentProvider && !aiProvider) {
    setAiProvider(currentProvider);
    if (!aiModelTouched && currentModel) {
      setAiModel(currentModel);
    }
  }

  async function handleAhConnect() {
    if (ahConnecting) return; // double-tap guard
    setAhConnecting(true);
    setAhError(false);
    try {
      await healthRequestAuth();
      setAhConnected(true);
    } catch {
      setAhError(true);
    } finally {
      setAhConnecting(false);
    }
  }

  async function handleAhSync() {
    setAhSyncing(true);
    setAhResult(null);
    setAhFailed(0);
    setAhError(false);
    try {
      // 1. Query Apple Health for the past 30 days
      const samples = await healthQuerySamples(30);

      // 2. Merge fragmented sleep samples
      const mergedSleep = mergeSleepSamples(samples.sleep);

      // 3. Fetch existing records from BodyAtlas over the same 30-day window
      const toDate = new Date();
      const fromDate = addDays(toDate, -30);
      const fromIso = fromDate.toISOString();
      const toIso = toDate.toISOString();

      const [existingSleep, existingMeasurements] = await Promise.all([
        api.sleep.$get({ query: { from: fromIso, to: toIso } }).then((r) => {
          if (!r.ok) throw new Error(`sleep fetch failed: ${r.status}`);
          return r.json() as Promise<SleepRecord[]>;
        }),
        api.measurements.$get({ query: { from: fromIso, to: toIso } }).then((r) => {
          if (!r.ok) throw new Error(`measurements fetch failed: ${r.status}`);
          return r.json() as Promise<Measurement[]>;
        }),
      ]);

      // 4. Build existing day-key sets (sleep keyed on wokeAt, measurements on measuredAt)
      const existingSleepDays = new Set(existingSleep.map((r) => localDayKey(r.wokeAt)));
      const existingMeasurementDays = new Set(
        existingMeasurements.map((r) => localDayKey(r.measuredAt)),
      );

      // 5. Dedupe: pick only new days
      const newSleep = pickNewDays(mergedSleep, existingSleepDays, (r) => localDayKey(r.wokeAt));

      // 6. Merge weight + bodyFat samples by local day into one measurement per day,
      //    keeping the original sample timestamp (never import-time "now")
      const allMeasurements = mergeMeasurementSamples(samples.weight, samples.bodyFat);
      const newMeasurements = pickNewDays(
        allMeasurements,
        existingMeasurementDays,
        (m) => m.day,
      );

      // 7-8. POST sequentially, per-record try/catch so a mid-import failure
      // still reports how many records actually persisted
      let sleepOk = 0;
      let weightOk = 0;
      let failed = 0;

      for (const record of newSleep) {
        try {
          await createSleep.mutateAsync({ bedAt: record.bedAt, wokeAt: record.wokeAt });
          sleepOk++;
        } catch {
          failed++;
        }
      }

      for (const m of newMeasurements) {
        const input: { measuredAt: string; weightKg?: number; bodyFatPct?: number } = {
          measuredAt: m.measuredAt,
        };
        if (m.kg !== undefined) input.weightKg = m.kg;
        if (m.pct !== undefined) input.bodyFatPct = m.pct;
        try {
          await createMeasurement.mutateAsync(input);
          weightOk++;
        } catch {
          failed++;
        }
      }

      setAhResult({ sleep: sleepOk, weight: weightOk });
      setAhFailed(failed);
    } catch {
      setAhError(true);
    } finally {
      setAhSyncing(false);
    }
  }

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

  const handleCreateToken = async () => {
    if (!newTokenName.trim()) return;
    try {
      const result = await createToken.mutateAsync(newTokenName.trim());
      setCreatedToken(result);
      setNewTokenName('');
    } catch {
      // error handled by mutation state
    }
  };

  const handleCopyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.token);
    } catch {
      // clipboard not available — user can copy manually
    }
  };

  const handleRevokeToken = async (id: string) => {
    if (!window.confirm(t('settings.revoke') + '?')) return;
    try {
      await revokeToken.mutateAsync(id);
    } catch {
      // error handled by mutation state
    }
  };

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

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>{t('settings.tokens')}</h2>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            placeholder={t('settings.tokenName')}
            value={newTokenName}
            onChange={(e) => setNewTokenName(e.target.value)}
            style={{ ...fieldStyle, marginTop: 0, flex: '1 1 200px' }}
          />
          <button
            type="button"
            onClick={handleCreateToken}
            disabled={!newTokenName.trim() || createToken.isPending}
            style={{
              padding: '10px 16px',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              cursor: newTokenName.trim() ? 'pointer' : 'not-allowed',
              opacity: newTokenName.trim() ? 1 : 0.5,
            }}
          >
            {t('settings.createToken')}
          </button>
        </div>

        {createdToken && (
          <div className="glow-card is-active" style={{ marginBottom: 16, padding: 16 }}>
            <p style={{ color: 'var(--positive)', marginBottom: 8 }}>
              {t('settings.tokenCreated')}
            </p>
            <code
              style={{
                display: 'block',
                wordBreak: 'break-all',
                marginBottom: 8,
                padding: 8,
                background: 'var(--surface-2)',
                borderRadius: 'var(--radius)',
              }}
            >
              {createdToken.token}
            </code>
            <button
              type="button"
              onClick={handleCopyToken}
              style={{
                padding: '6px 12px',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                marginBottom: 8,
              }}
            >
              Copy
            </button>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              {t('settings.mcpHint')}
            </p>
          </div>
        )}

        {tokens.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {tokens.map((tok) => (
              <li
                key={tok.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div>
                  <span style={{ fontWeight: 500 }}>{tok.name}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>
                    {t('settings.lastUsed')}:{' '}
                    {tok.lastUsedAt
                      ? new Date(tok.lastUsedAt).toLocaleDateString()
                      : t('settings.neverUsed')}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(tok.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeToken(tok.id)}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--surface-2)',
                    color: 'var(--negative)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AI coach section */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>{t('ai.title')}</h2>

        <label style={{ display: 'block', marginBottom: 12 }}>
          {t('ai.provider')}
          <select
            aria-label={t('ai.provider')}
            style={fieldStyle}
            value={aiProvider}
            onChange={(e) => handleProviderChange(e.target.value as AiProvider | '')}
          >
            <option value="">—</option>
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'block', marginBottom: 12 }}>
          {t('ai.model')}
          <input
            aria-label={t('ai.model')}
            style={fieldStyle}
            value={aiModel}
            placeholder={
              aiProvider === 'openai'
                ? 'e.g. gpt-…'
                : aiProvider === 'gemini'
                  ? 'e.g. gemini-…'
                  : ''
            }
            onChange={(e) => {
              setAiModel(e.target.value);
              setAiModelTouched(true);
            }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 4 }}>
          {t('ai.apiKey')}
          <input
            aria-label={t('ai.apiKey')}
            type="password"
            style={fieldStyle}
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            placeholder={hasKey ? '••••••••' : ''}
          />
        </label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          {t('ai.apiKeyHint')}
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <button
            type="button"
            disabled={
              !aiProvider ||
              !aiModel.trim() ||
              (!hasKey && !aiKey.trim()) ||
              saveAiSettings.isPending
            }
            onClick={handleAiSave}
            style={{
              padding: '10px 16px',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              opacity: (!aiProvider || !aiModel.trim() || (!hasKey && !aiKey.trim())) ? 0.5 : 1,
            }}
          >
            {t('ai.save')}
          </button>

          {hasKey && (
            <>
              <button
                type="button"
                disabled={testAi.isPending}
                onClick={handleAiTest}
                style={{
                  padding: '10px 16px',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                }}
              >
                {t('ai.test')}
              </button>
              <button
                type="button"
                disabled={deleteAiSettings.isPending}
                onClick={handleAiDisconnect}
                style={{
                  padding: '10px 16px',
                  background: 'var(--surface-2)',
                  color: 'var(--negative)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                }}
              >
                {t('ai.disconnect')}
              </button>
            </>
          )}
        </div>

        {testStatus === 'ok' && (
          <p style={{ color: 'var(--positive)' }}>{t('ai.testOk')}</p>
        )}
        {testStatus === 'error' && (
          <p style={{ color: 'var(--negative)' }}>{t('ai.error')}</p>
        )}
      </section>

      {update.isSuccess && (
        <p style={{ color: 'var(--positive)' }}>{t('settings.saved')}</p>
      )}
      {update.isError && (
        <p style={{ color: 'var(--negative)' }}>{t('error.generic')}</p>
      )}

      {/* Apple Health section — shown only in the native iOS shell */}
      {isNativeShell() && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>{t('native.appleHealth')}</h2>

          {!ahConnected && (
            <button
              type="button"
              onClick={handleAhConnect}
              disabled={ahConnecting}
              style={{
                padding: '10px 16px',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                cursor: ahConnecting ? 'not-allowed' : 'pointer',
                opacity: ahConnecting ? 0.6 : 1,
                marginBottom: 12,
              }}
            >
              {t('native.connect')}
            </button>
          )}

          {ahConnected && (
            <button
              type="button"
              onClick={handleAhSync}
              disabled={ahSyncing}
              style={{
                padding: '10px 16px',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                cursor: ahSyncing ? 'not-allowed' : 'pointer',
                opacity: ahSyncing ? 0.6 : 1,
                marginBottom: 12,
              }}
            >
              {ahSyncing ? t('native.syncing') : t('native.sync')}
            </button>
          )}

          {ahResult !== null && (
            <p style={{ color: 'var(--positive)' }}>
              {t('native.syncResult')
                .replace('{sleep}', String(ahResult.sleep))
                .replace('{weight}', String(ahResult.weight))}
            </p>
          )}

          {ahFailed > 0 && (
            <p style={{ color: 'var(--negative)' }}>
              {t('native.syncPartial').replace('{failed}', String(ahFailed))}
            </p>
          )}

          {ahError && (
            <p style={{ color: 'var(--negative)' }}>{t('native.syncError')}</p>
          )}
        </section>
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
