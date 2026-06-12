import { useI18n } from '../i18n';

export function LoginPage() {
  const { t } = useI18n();
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
      <a
        href="/auth/google"
        style={{
          background: 'var(--accent)',
          color: 'var(--accent-contrast)',
          padding: '12px 24px',
          borderRadius: 'var(--radius)',
          textDecoration: 'none',
          fontWeight: 700,
        }}
      >
        {t('login.signIn')}
      </a>
    </main>
  );
}
