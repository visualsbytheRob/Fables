/**
 * AI request queue tests (F1306).
 */

import { describe, expect, it } from 'vitest';
import { AiRequestQueue, CancellationError } from './queue.js';

const defer = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('AiRequestQueue', () => {
  it('runs tasks and returns their results', async () => {
    const q = new AiRequestQueue(2);
    const a = q.enqueue(async () => 1);
    const b = q.enqueue(async () => 2);
    expect(await a.promise).toBe(1);
    expect(await b.promise).toBe(2);
  });

  it('limits concurrency to the configured capacity', async () => {
    const q = new AiRequestQueue(1);
    let active = 0;
    let maxActive = 0;
    const make = () =>
      q.enqueue(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
    await Promise.all([make().promise, make().promise, make().promise]);
    expect(maxActive).toBe(1);
  });

  it('reports queued/running stats', async () => {
    const q = new AiRequestQueue(1);
    const d = defer<number>();
    const running = q.enqueue(() => d.promise);
    const queued = q.enqueue(async () => 9);
    const stats = q.stats();
    expect(stats.running).toBe(1);
    expect(stats.queued).toBe(1);
    expect(stats.capacity).toBe(1);
    d.resolve(1);
    await running.promise;
    await queued.promise;
  });

  it('cancels a still-queued task before it runs', async () => {
    const q = new AiRequestQueue(1);
    const d = defer<number>();
    const blocker = q.enqueue(() => d.promise);
    let ran = false;
    const queued = q.enqueue(async () => {
      ran = true;
      return 1;
    });
    expect(q.cancel(queued.id)).toBe(true);
    expect(queued.status).toBe('cancelled');
    await expect(queued.promise).rejects.toBeInstanceOf(CancellationError);
    d.resolve(0);
    await blocker.promise;
    expect(ran).toBe(false);
  });

  it('cancels a running task via its AbortSignal', async () => {
    const q = new AiRequestQueue(1);
    const task = q.enqueue(
      (signal) =>
        new Promise<number>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    // Let it start.
    await new Promise((r) => setTimeout(r, 1));
    expect(q.cancel(task.id)).toBe(true);
    await expect(task.promise).rejects.toBeInstanceOf(CancellationError);
  });

  it('propagates task errors', async () => {
    const q = new AiRequestQueue(1);
    const task = q.enqueue(async () => {
      throw new Error('boom');
    });
    await expect(task.promise).rejects.toThrow('boom');
    expect(task.status).toBe('error');
  });

  it('cancelAll clears the queue', async () => {
    const q = new AiRequestQueue(1);
    const d = defer<number>();
    const a = q.enqueue(() => d.promise);
    const b = q.enqueue(async () => 2);
    q.cancelAll();
    await expect(a.promise).rejects.toBeInstanceOf(CancellationError);
    await expect(b.promise).rejects.toBeInstanceOf(CancellationError);
  });
});
