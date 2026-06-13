/**
 * Trigger a download of the user's full data export. Raw fetch + blob because
 * the response is a file attachment, not a typed JSON RPC body.
 */
export async function downloadExport(): Promise<void> {
  const res = await fetch('/api/account/export', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `bodyatlas-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Permanently delete the account; the server revokes the session. */
export async function deleteAccount(): Promise<void> {
  const res = await fetch('/api/account', { method: 'DELETE', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
