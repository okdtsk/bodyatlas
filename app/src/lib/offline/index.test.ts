import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryQueueStore } from './memory-store';
import { OfflineQueue } from './queue';
import { createController } from './index';

describe('offline controller', () => {
  afterEach(() => vi.restoreAllMocks());

  it('flushes pending ops when an online event fires', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const queue = new OfflineQueue(new MemoryQueueStore());
    await queue.load();
    await queue.enqueue('meal', { name: 'Eggs' });
    const send = vi.fn(async () => ({ ok: true, status: 201 }));

    const controller = createController(queue, send);
    await controller.start(); // initial flush since online
    expect(queue.pending()).toHaveLength(0);

    await queue.enqueue('meal', { name: 'Toast' });
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(queue.pending()).toHaveLength(0));

    controller.stop();
  });

  it('does not flush on start when offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const queue = new OfflineQueue(new MemoryQueueStore());
    await queue.load();
    await queue.enqueue('meal', { name: 'Eggs' });
    const send = vi.fn(async () => ({ ok: true, status: 201 }));
    const controller = createController(queue, send);
    await controller.start();
    expect(send).not.toHaveBeenCalled();
    controller.stop();
  });
});
