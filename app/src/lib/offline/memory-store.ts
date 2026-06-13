import type { QueuedOp, QueueStore } from './types';

/** Volatile QueueStore for tests and as a fallback when IndexedDB is unavailable. */
export class MemoryQueueStore implements QueueStore {
  private ops: QueuedOp[] = [];

  async list(): Promise<QueuedOp[]> {
    return this.ops.map((op) => ({ ...op }));
  }

  async put(op: QueuedOp): Promise<void> {
    const i = this.ops.findIndex((o) => o.id === op.id);
    if (i >= 0) this.ops[i] = { ...op };
    else this.ops.push({ ...op });
  }

  async remove(id: string): Promise<void> {
    this.ops = this.ops.filter((o) => o.id !== id);
  }
}
