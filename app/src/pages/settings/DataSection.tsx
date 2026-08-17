import { useState } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n';
import { downloadExport, deleteAccount } from '../../lib/account';

export function DataSection() {
  const { t } = useI18n();

  // Account export state
  const [exportError, setExportError] = useState(false);

  // Account deletion state
  const [confirmText, setConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmWord = t('account.deleteConfirmWord');

  return (
    <section className="panel stack">
      <h2 className="label">{t('account.section')}</h2>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={async () => {
          setExportError(false);
          try {
            await downloadExport();
          } catch {
            setExportError(true);
          }
        }}
      >
        {t('account.export')}
      </button>
      {exportError && <p style={{ color: 'var(--negative)' }}>{t('account.exportError')}</p>}

      <p>
        <Link to="/privacy">{t('privacy.link')}</Link>
      </p>

      <div
        className="stack"
        style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)' }}
      >
        <h3 style={{ color: 'var(--negative)' }}>{t('account.dangerZone')}</h3>
        <p className="muted">{t('account.deleteWarning')}</p>
        <label className="field">
          <span className="label">{t('account.deleteConfirmLabel')}</span>
          <input
            className="input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-danger"
          disabled={confirmText !== confirmWord || deleting}
          onClick={async () => {
            setDeleteError(false);
            setDeleting(true);
            try {
              await deleteAccount();
              window.location.href = '/';
            } catch {
              setDeleteError(true);
              setDeleting(false);
            }
          }}
        >
          {t('account.delete')}
        </button>
        {deleteError && <p style={{ color: 'var(--negative)' }}>{t('account.deleteError')}</p>}
      </div>

      <form method="post" action="/auth/logout">
        <button type="submit" className="btn btn-secondary">
          {t('settings.signOut')}
        </button>
      </form>
    </section>
  );
}
