import type { OpKind, QueuedOp, QueueStore, SetContext } from './types';

/**
 * In-memory mirror of the persisted queue with a subscribe API, suitable for
 * useSyncExternalStore. getSnapshot returns a referentially stable array that
 * only changes identity when the queue changes.
 */
export class OfflineQueue {
  private ops: QueuedOp[] = [];
  private snapshot: QueuedOp[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly store: QueueStore) {}

  /** Load persisted ops into the in-memory mirror. Call once at startup. */
  async load(): Promise<void> {
    this.ops = await this.store.list();
    this.refresh();
  }

  async enqueue(
    kind: OpKind,
    payload: Record<string, unknown>,
    context?: SetContext,
  ): Promise<QueuedOp> {
    const id = crypto.randomUUID();
    const op: QueuedOp = {
      id,
      kind,
      payload: { ...payload, clientId: id },
      ...(context ? { context } : {}),
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    await this.store.put(op);
    this.ops.push(op);
    this.refresh();
    return op;
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
    this.ops = this.ops.filter((o) => o.id !== id);
    this.refresh();
  }

  async markFailed(id: string, error: string): Promise<void> {
    const op = this.ops.find((o) => o.id === id);
    if (!op) return;
    const updated: QueuedOp = { ...op, status: 'failed', error };
    await this.store.put(updated);
    this.ops = this.ops.map((o) => (o.id === id ? updated : o));
    this.refresh();
  }

  /**
   * Ops still awaiting a successful flush (status === 'pending'), FIFO order.
   * Sorted by createdAt because after a reload the IndexedDB store returns rows
   * in key (random UUID) order, not insertion order.
   */
  pending(): QueuedOp[] {
    return this.ops
      .filter((o) => o.status === 'pending')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getSnapshot(): QueuedOp[] {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private refresh(): void {
    this.snapshot = this.ops.map((o) => ({ ...o }));
    for (const l of this.listeners) l();
  }
}
