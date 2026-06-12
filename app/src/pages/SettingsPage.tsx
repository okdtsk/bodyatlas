import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LOCALES, THEMES, type UpdateMe } from '@bodyatlas/shared';
import { useI18n, type MessageKey } from '../i18n';
import { api } from '../lib/api';
import { useCreateToken, useRevokeToken, useTokens, type CreatedToken } from '../lib/tokens';
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

  const { data: tokens = [] } = useTokens();
  const createToken = useCreateToken();
  const revokeToken = useRevokeToken();

  const [newTokenName, setNewTokenName] = useState('');
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);

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
