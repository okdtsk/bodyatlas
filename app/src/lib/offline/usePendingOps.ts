import { useSyncExternalStore } from 'react';
import { offlineQueue } from './index';
import type { OpKind, QueuedOp } from './types';

/** All queued ops (pending + failed), reactive to queue changes. */
export function useQueuedOps(): QueuedOp[] {
  return useSyncExternalStore(
    (cb) => offlineQueue.subscribe(cb),
    () => offlineQueue.getSnapshot(),
    () => offlineQueue.getSnapshot(),
  );
}

/** Queued ops of one kind. */
export function useQueuedOpsByKind(kind: OpKind): QueuedOp[] {
  return useQueuedOps().filter((o) => o.kind === kind);
}
