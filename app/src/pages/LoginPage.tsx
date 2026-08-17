import { useState } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../i18n';
import { isNativeShell, nativeGoogleSignIn } from '../lib/native';

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
    <main className="login-main">
      <h1 className="login-title">{t('app.name')}</h1>
      <p className="muted" style={{ maxWidth: '40ch' }}>{t('login.welcome')}</p>
      {isNativeShell() ? (
        <button type="button" className="btn btn-primary btn-lg" onClick={handleNativeSignIn} disabled={busy}>
          {t('login.signIn')}
        </button>
      ) : (
        <a className="btn btn-primary btn-lg" href="/auth/google">{t('login.signIn')}</a>
      )}
      {error && <p className="error-text" style={{ maxWidth: '40ch' }}>{error}</p>}
      <Link className="muted" to="/privacy">{t('privacy.link')}</Link>
    </main>
  );
}
