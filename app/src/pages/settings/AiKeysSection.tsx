import { useState } from 'react';
import { AI_PROVIDERS, type AiProvider } from '@bodyatlas/shared';
import { useI18n } from '../../i18n';
import { useAiSettings, useSaveAiSettings, useDeleteAiSettings, useTestAi } from '../../lib/ai';

export function AiKeysSection() {
  const { t } = useI18n();

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

  return (
    <section className="panel stack">
      <h2 className="label">{t('ai.title')}</h2>

      <label className="field">
        <span className="label">{t('ai.provider')}</span>
        <select
          aria-label={t('ai.provider')}
          className="input"
          value={aiProvider}
          onChange={(e) => handleProviderChange(e.target.value as AiProvider | '')}
        >
          <option value="">{t('common.none')}</option>
          {AI_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="label">{t('ai.model')}</span>
        <input
          aria-label={t('ai.model')}
          className="input"
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

      <label className="field">
        <span className="label">{t('ai.apiKey')}</span>
        <input
          aria-label={t('ai.apiKey')}
          type="password"
          className="input"
          value={aiKey}
          onChange={(e) => setAiKey(e.target.value)}
          placeholder={hasKey ? '••••••••' : ''}
        />
      </label>
      <p className="muted">{t('ai.apiKeyHint')}</p>

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={
            !aiProvider ||
            !aiModel.trim() ||
            (!hasKey && !aiKey.trim()) ||
            saveAiSettings.isPending
          }
          onClick={handleAiSave}
        >
          {t('ai.save')}
        </button>

        {hasKey && (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={testAi.isPending}
              onClick={handleAiTest}
            >
              {t('ai.test')}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={deleteAiSettings.isPending}
              onClick={handleAiDisconnect}
            >
              {t('ai.disconnect')}
            </button>
          </>
        )}
      </div>

      {testStatus === 'ok' && <p style={{ color: 'var(--positive)' }}>{t('ai.testOk')}</p>}
      {testStatus === 'error' && <p style={{ color: 'var(--negative)' }}>{t('ai.error')}</p>}
    </section>
  );
}
