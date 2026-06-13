import { useState } from 'react';
import type { CSSProperties } from 'react';
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
  const [failed, setFailed] = useState(false);

  const handleNativeSignIn = async () => {
    setBusy(true);
    setFailed(false);
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
      setFailed(true);
    } catch {
      // Plugin rejection (e.g. the user canceled the browser sheet):
      // silently return to the idle login screen.
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
      {failed && <p style={{ color: 'var(--negative)' }}>{t('login.nativeError')}</p>}
    </main>
  );
}
