import { api } from '../api';
import type { QueuedOp } from './types';
import type { SendResult } from './flush';

/**
 * Replay a queued op against the API, carrying its clientId (already in payload).
 * Returns { ok, status }; lets network errors throw so flushQueue can stop.
 */
export async function sendOp(op: QueuedOp): Promise<SendResult> {
  const res = await callFor(op);
  return { ok: res.ok, status: res.status };
}

function callFor(op: QueuedOp) {
  switch (op.kind) {
    case 'meal':
      return api.meals.$post({ json: op.payload as never });
    case 'sleep':
      return api.sleep.$post({ json: op.payload as never });
    case 'measurement':
      return api.measurements.$post({ json: op.payload as never });
    case 'set': {
      const ctx = op.context;
      if (!ctx) throw new Error('set op missing workout context');
      return api.workouts[':id'].exercises[':weId'].sets.$post({
        param: { id: ctx.workoutId, weId: ctx.weId },
        json: op.payload as never,
      });
    }
  }
}
