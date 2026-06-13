import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOfflineError, isOnline, onOnline } from './connectivity';

describe('connectivity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('isOnline reflects navigator.onLine', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(isOnline()).toBe(false);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(isOnline()).toBe(true);
  });

  it('onOnline fires the callback on an online event and unsubscribes', () => {
    const cb = vi.fn();
    const off = onOnline(cb);
    window.dispatchEvent(new Event('online'));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(new Event('online'));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('isOfflineError treats a TypeError as offline and an HTTP error as not', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOfflineError(new Error('API error 422'))).toBe(false);
  });

  it('isOfflineError treats any error as offline when navigator is offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(isOfflineError(new Error('API error 500'))).toBe(true);
  });
});
