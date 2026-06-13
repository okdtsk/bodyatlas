import { describe, expect, it, vi } from 'vitest';
import { MemoryQueueStore } from './memory-store';
import { OfflineQueue } from './queue';
import { flushQueue } from './flush';
import type { SendResult } from './flush';

async function queueWith(n: number): Promise<OfflineQueue> {
  const q = new OfflineQueue(new MemoryQueueStore());
  await q.load();
  for (let i = 0; i < n; i++) await q.enqueue('meal', { name: `m${i}` });
  return q;
}

const ok: SendResult = { ok: true, status: 201 };

describe('flushQueue', () => {
  it('drains all ops FIFO on success and clears the queue', async () => {
    const q = await queueWith(3);
    const order: string[] = [];
    const send = vi.fn(async (op) => {
      order.push(op.payload.name as string);
      return ok;
    });
    const result = await flushQueue(q, send);
    expect(order).toEqual(['m0', 'm1', 'm2']);
    expect(q.pending()).toHaveLength(0);
    expect(result.flushed).toBe(3);
  });

  it('dead-letters a 4xx op and keeps draining the rest', async () => {
    const q = await queueWith(2);
    const send = vi.fn(async (op) =>
      op.payload.name === 'm0' ? { ok: false, status: 422 } : ok,
    );
    const result = await flushQueue(q, send);
    expect(q.pending()).toHaveLength(0); // m1 flushed
    expect(q.getSnapshot().filter((o) => o.status === 'failed')).toHaveLength(1); // m0 dead-lettered
    expect(result.failed).toBe(1);
    expect(result.flushed).toBe(1);
  });

  it('stops on a network error and retains the unsent ops', async () => {
    const q = await queueWith(3);
    const send = vi.fn(async (op) => {
      if (op.payload.name === 'm1') throw new TypeError('Failed to fetch');
      return ok;
    });
    const result = await flushQueue(q, send);
    expect(result.stoppedReason).toBe('network');
    expect(q.pending().map((o) => o.payload.name)).toEqual(['m1', 'm2']); // m0 removed, m1/m2 retained
  });

  it('stops on 401 and retains the ops', async () => {
    const q = await queueWith(2);
    const send = vi.fn(async () => ({ ok: false, status: 401 }) as SendResult);
    const result = await flushQueue(q, send);
    expect(result.stoppedReason).toBe('auth');
    expect(q.pending()).toHaveLength(2);
  });

  it('is a no-op when there is nothing pending', async () => {
    const q = await queueWith(0);
    const send = vi.fn();
    const result = await flushQueue(q, send);
    expect(send).not.toHaveBeenCalled();
    expect(result.flushed).toBe(0);
  });
});
