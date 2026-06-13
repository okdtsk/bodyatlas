import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IdbQueueStore } from './idb-store';
import type { QueuedOp } from './types';

const op = (id: string): QueuedOp => ({
  id,
  kind: 'meal',
  payload: { name: 'Eggs', clientId: id },
  createdAt: '2026-06-13T00:00:00.000Z',
  status: 'pending',
});

describe('IdbQueueStore', () => {
  beforeEach(() => {
    indexedDB.deleteDatabase('bodyatlas-offline');
  });

  it('persists, lists, and removes ops', async () => {
    const store = new IdbQueueStore();
    await store.put(op('a'));
    await store.put(op('b'));
    expect((await store.list()).map((o) => o.id).sort()).toEqual(['a', 'b']);
    await store.remove('a');
    expect((await store.list()).map((o) => o.id)).toEqual(['b']);
  });

  it('put overwrites an existing op by id', async () => {
    const store = new IdbQueueStore();
    await store.put(op('a'));
    await store.put({ ...op('a'), status: 'failed', error: 'x' });
    const [row] = await store.list();
    expect(row?.status).toBe('failed');
  });

  it('a fresh store instance sees previously persisted ops (survives reload)', async () => {
    await new IdbQueueStore().put(op('a'));
    const reopened = new IdbQueueStore();
    expect((await reopened.list())).toHaveLength(1);
  });
});
