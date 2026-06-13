import { isOnline, onOnline } from './connectivity';
import { flushQueue, type Sender } from './flush';
import { IdbQueueStore } from './idb-store';
import { MemoryQueueStore } from './memory-store';
import { OfflineQueue } from './queue';
import { sendOp } from './senders';

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
export function createController(queue: OfflineQueue, send: Sender): Controller {
  let off: (() => void) | undefined;
  let running = false;

  const flush = async () => {
    if (running || !isOnline()) return;
    running = true;
    try {
      await flushQueue(queue, send);
    } finally {
      running = false;
    }
  };

  return {
    async start() {
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

/** Default controller bound to the app singleton queue + real senders. */
export const offlineController = createController(offlineQueue, sendOp);
