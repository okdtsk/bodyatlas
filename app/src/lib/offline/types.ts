export type OpKind = 'meal' | 'measurement' | 'sleep' | 'set';

export interface SetContext {
  workoutId: string;
  weId: string;
}

export interface QueuedOp {
  id: string; // UUID — also the server clientId
  kind: OpKind;
  payload: Record<string, unknown>; // request body, already including clientId
  context?: SetContext; // present only for kind === 'set'
  createdAt: string; // ISO
  status: 'pending' | 'failed';
  error?: string;
}

/** Async persistence backend for the queue. */
export interface QueueStore {
  list(): Promise<QueuedOp[]>;
  put(op: QueuedOp): Promise<void>;
  remove(id: string): Promise<void>;
}
