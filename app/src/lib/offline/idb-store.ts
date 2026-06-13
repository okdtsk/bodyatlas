import type { QueuedOp, QueueStore } from './types';

const DB_NAME = 'bodyatlas-offline';
const STORE = 'operations';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

/** IndexedDB-backed QueueStore. Each method opens, transacts, and closes. */
export class IdbQueueStore implements QueueStore {
  async list(): Promise<QueuedOp[]> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readonly');
      return (await promisify(tx.objectStore(STORE).getAll())) as QueuedOp[];
    } finally {
      db.close();
    }
  }

  async put(op: QueuedOp): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      await promisify(tx.objectStore(STORE).put(op));
    } finally {
      db.close();
    }
  }

  async remove(id: string): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      await promisify(tx.objectStore(STORE).delete(id));
    } finally {
      db.close();
    }
  }
}
