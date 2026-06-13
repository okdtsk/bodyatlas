import type { QueryClient } from '@tanstack/react-query';
import { isOnline, onOnline } from './connectivity';
import { flushQueue, type OnFlushed, type Sender } from './flush';
import { IdbQueueStore } from './idb-store';
import { MemoryQueueStore } from './memory-store';
import { OfflineQueue } from './queue';
import { sendOp } from './senders';
import type { OpKind } from './types';

export { OfflineQueue } from './queue';
export type { QueuedOp, OpKind } from './types';

/** The app-wide queue. IndexedDB when available, memory as a fallback. */
function makeStore() {
  return typeof indexedDB !== 'undefined' ? new IdbQueueStore() : new MemoryQueueStore();
}

export const offlineQueue = new OfflineQueue(makeStore());

export interface Controller {
  start(): Promise<void>;
  stop(): void;
  flushNow(): Promise<void>;
}

/** Wire a queue to connectivity: flush on start (if online) and on reconnect. */
export function createController(queue: OfflineQueue, send: Sender, onFlushed?: OnFlushed): Controller {
  let off: (() => void) | undefined;
  let running = false;

  const flush = async () => {
    if (running || !isOnline()) return;
    running = true;
    try {
      await flushQueue(queue, send, onFlushed);
    } finally {
      running = false;
    }
  };

  return {
    async start() {
      off?.(); // guard against a double start() leaking a listener (e.g. StrictMode)
      off = onOnline(() => void flush());
      await flush();
    },
    stop() {
      off?.();
      off = undefined;
    },
    flushNow: flush,
  };
}

/** Query keys to invalidate after an op of each kind is synced (mirrors each hook's onSuccess). */
const KIND_QUERY_KEYS: Record<OpKind, string[][]> = {
  meal: [['meals'], ['meal-search']],
  sleep: [['sleep']],
  measurement: [['measurements']],
  set: [['workouts']],
};

/**
 * App controller bound to the singleton queue + real senders, invalidating the
 * affected React Query caches as each op syncs. This makes reconciliation
 * explicit rather than relying on React Query's refetchOnReconnect default: when
 * a queued write lands, its provisional row is removed and the real row refetched.
 */
export function createAppController(queryClient: QueryClient): Controller {
  return createController(offlineQueue, sendOp, (op) => {
    for (const queryKey of KIND_QUERY_KEYS[op.kind]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  });
}
