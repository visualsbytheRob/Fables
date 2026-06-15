/**
 * AI request queue with cancellation (F1306).
 *
 * A concurrency-limited FIFO queue for AI generations: callers enqueue a task
 * and receive a handle they can await or cancel. Cancellation settles the task
 * immediately (and aborts its AbortSignal so a cooperating runner can stop
 * early); a still-queued task is dropped before it ever runs. Pure
 * orchestration — the task does the I/O, this only schedules, bounds
 * concurrency, and tracks state. Each task is finalized exactly once.
 */

export type QueueTaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface QueueTask<T> {
  id: string;
  status: QueueTaskStatus;
  /** Resolves with the task result, or rejects on error/cancellation. */
  promise: Promise<T>;
  /** Cancel this task (no-op once it has finished). */
  cancel: () => void;
  enqueuedAt: number;
}

export interface QueueStats {
  queued: number;
  running: number;
  capacity: number;
}

interface Pending<T> {
  id: string;
  run: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  controller: AbortController;
  task: QueueTask<T>;
  /** True once the queue has settled this task (guards double-settle). */
  finalized: boolean;
  /** True while occupying a concurrency slot. */
  active: boolean;
}

export class CancellationError extends Error {
  constructor(message = 'request cancelled') {
    super(message);
    this.name = 'CancellationError';
  }
}

export class AiRequestQueue {
  private readonly waiting: Pending<unknown>[] = [];
  private readonly runningTasks = new Map<string, Pending<unknown>>();
  private running = 0;
  private counter = 0;

  constructor(private readonly concurrency = 1) {
    if (concurrency < 1) throw new Error('concurrency must be >= 1');
  }

  /** Enqueue a task. `run` receives an AbortSignal it should honour. */
  enqueue<T>(run: (signal: AbortSignal) => Promise<T>): QueueTask<T> {
    const id = `aiq_${(this.counter += 1)}`;
    const controller = new AbortController();
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const task: QueueTask<T> = {
      id,
      status: 'queued',
      promise,
      enqueuedAt: Date.now(),
      cancel: () => this.cancel(id),
    };

    const pending: Pending<T> = {
      id,
      run,
      resolve,
      reject,
      controller,
      task,
      finalized: false,
      active: false,
    };
    this.waiting.push(pending as Pending<unknown>);
    this.pump();
    return task;
  }

  /** Cancel a task by id; returns true if it was queued or running. */
  cancel(id: string): boolean {
    const queuedIndex = this.waiting.findIndex((p) => p.id === id);
    if (queuedIndex >= 0) {
      const [pending] = this.waiting.splice(queuedIndex, 1);
      if (pending) this.settle(pending, 'cancelled', new CancellationError());
      return true;
    }
    const running = this.runningTasks.get(id);
    if (running) {
      running.controller.abort();
      this.settle(running, 'cancelled', new CancellationError());
      return true;
    }
    return false;
  }

  /** Cancel everything queued and running. */
  cancelAll(): void {
    for (const p of [...this.waiting]) this.cancel(p.id);
    for (const id of [...this.runningTasks.keys()]) this.cancel(id);
  }

  stats(): QueueStats {
    return { queued: this.waiting.length, running: this.running, capacity: this.concurrency };
  }

  /** Settle a task exactly once, releasing its slot and pumping the queue. */
  private settle<T>(
    pending: Pending<T>,
    status: Exclude<QueueTaskStatus, 'queued' | 'running'>,
    valueOrError: unknown,
  ): void {
    if (pending.finalized) return;
    pending.finalized = true;
    pending.task.status = status;
    if (status === 'done') pending.resolve(valueOrError as T);
    else pending.reject(valueOrError);
    if (pending.active) {
      pending.active = false;
      this.running -= 1;
      this.runningTasks.delete(pending.id);
      this.pump();
    }
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const pending = this.waiting.shift()!;
      this.running += 1;
      pending.active = true;
      this.runningTasks.set(pending.id, pending);
      pending.task.status = 'running';

      void pending
        .run(pending.controller.signal)
        .then((value) => {
          this.settle(pending, 'done', value);
        })
        .catch((err: unknown) => {
          const cancelled = pending.controller.signal.aborted || pending.finalized;
          this.settle(
            pending,
            cancelled ? 'cancelled' : 'error',
            cancelled ? new CancellationError() : err,
          );
        });
    }
  }
}
