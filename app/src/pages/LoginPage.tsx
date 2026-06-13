import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../i18n';
import { isNativeShell, nativeGoogleSignIn } from '../lib/native';

const signInStyle: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--accent-contrast)',
  padding: '12px 24px',
  borderRadius: 'var(--radius)',
  textDecoration: 'none',
  fontWeight: 700,
};

export function LoginPage() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNativeSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const { code } = await nativeGoogleSignIn();
      const res = await fetch('/auth/native/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        credentials: 'same-origin',
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setError(`${t('login.nativeError')} (exchange ${res.status})`);
    } catch (err) {
      // The plugin rejects with "canceled" when the user dismisses the
      // browser sheet — return to the idle screen silently. Anything else
      // is a real failure and must be shown, not swallowed.
      const message = err instanceof Error ? err.message : String(err);
      if (message !== 'canceled') {
        setError(`${t('login.nativeError')} (${message})`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 32 }}>{t('app.name')}</h1>
      <p style={{ color: 'var(--text-muted)', maxWidth: 320 }}>{t('login.welcome')}</p>
      {isNativeShell() ? (
        <button
          type="button"
          onClick={handleNativeSignIn}
          disabled={busy}
          style={{
            ...signInStyle,
            border: 'none',
            font: 'inherit',
            fontWeight: 700,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {t('login.signIn')}
        </button>
      ) : (
        <a href="/auth/google" style={signInStyle}>
          {t('login.signIn')}
        </a>
      )}
      {error && <p style={{ color: 'var(--negative)', maxWidth: 320 }}>{error}</p>}
      <Link to="/privacy" style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        {t('privacy.link')}
      </Link>
    </main>
  );
}
