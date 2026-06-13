/** True when the browser believes it has a network connection. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/** Subscribe to 'came back online' transitions. Returns an unsubscribe fn. */
export function onOnline(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}

/**
 * Classify a thrown mutation error as an offline/network failure (enqueue) vs a
 * real HTTP error (surface). expectOk throws `Error('API error <status>')` for
 * HTTP responses; a network failure throws a TypeError before that. So: a
 * TypeError, or any error while navigator is offline, is treated as offline.
 */
export function isOfflineError(err: unknown): boolean {
  if (!isOnline()) return true;
  return err instanceof TypeError;
}
