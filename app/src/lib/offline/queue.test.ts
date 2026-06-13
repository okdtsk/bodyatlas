import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryQueueStore } from './memory-store';
import { OfflineQueue } from './queue';

describe('OfflineQueue', () => {
  let queue: OfflineQueue;
  beforeEach(async () => {
    queue = new OfflineQueue(new MemoryQueueStore());
    await queue.load();
  });

  it('enqueue adds a pending op with a uuid id and exposes it in the snapshot', async () => {
    const op = await queue.enqueue('meal', { name: 'Eggs' });
    expect(op.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(op.kind).toBe('meal');
    expect(op.status).toBe('pending');
    expect(op.payload.clientId).toBe(op.id); // clientId injected into payload
    expect(queue.getSnapshot()).toHaveLength(1);
  });

  it('enqueue with set context stores it', async () => {
    const op = await queue.enqueue('set', { reps: 5 }, { workoutId: 'w1', weId: 'we1' });
    expect(op.context).toEqual({ workoutId: 'w1', weId: 'we1' });
  });

  it('notifies subscribers on change and returns a stable snapshot between changes', async () => {
    const seen = vi.fn();
    queue.subscribe(seen);
    const before = queue.getSnapshot();
    expect(queue.getSnapshot()).toBe(before); // referentially stable
    await queue.enqueue('meal', { name: 'Eggs' });
    expect(seen).toHaveBeenCalled();
    expect(queue.getSnapshot()).not.toBe(before);
  });

  it('remove deletes the op; markFailed flips status and records the error', async () => {
    const op = await queue.enqueue('meal', { name: 'Eggs' });
    await queue.markFailed(op.id, 'API error 422');
    const failed = queue.getSnapshot()[0];
    expect(failed).toBeDefined();
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('API error 422');
    await queue.remove(op.id);
    expect(queue.getSnapshot()).toHaveLength(0);
  });

  it('load() rehydrates the snapshot from the store (survives a reload)', async () => {
    const store = new MemoryQueueStore();
    const q1 = new OfflineQueue(store);
    await q1.load();
    await q1.enqueue('sleep', { bedAt: 'a', wokeAt: 'b' });
    const q2 = new OfflineQueue(store);
    await q2.load();
    expect(q2.getSnapshot()).toHaveLength(1);
  });
});
