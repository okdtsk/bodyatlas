import type { OfflineQueue } from './queue';
import type { QueuedOp } from './types';

export interface SendResult {
  ok: boolean;
  status: number;
}

export type Sender = (op: QueuedOp) => Promise<SendResult>;

export interface FlushResult {
  flushed: number;
  failed: number;
  stoppedReason?: 'network' | 'auth';
}

/**
 * Drain the queue's pending ops FIFO.
 * - 2xx           -> remove the op
 * - 401           -> stop; retain remaining ops (session expired)
 * - other 4xx/5xx -> dead-letter the op (markFailed) and continue
 * - thrown error  -> network failure; stop and retain remaining ops
 */
export async function flushQueue(queue: OfflineQueue, send: Sender): Promise<FlushResult> {
  let flushed = 0;
  let failed = 0;
  for (const op of queue.pending()) {
    let result: SendResult;
    try {
      result = await send(op);
    } catch {
      return { flushed, failed, stoppedReason: 'network' };
    }
    if (result.ok) {
      await queue.remove(op.id);
      flushed++;
    } else if (result.status === 401) {
      return { flushed, failed, stoppedReason: 'auth' };
    } else {
      await queue.markFailed(op.id, `API error ${result.status}`);
      failed++;
    }
  }
  return { flushed, failed };
}
