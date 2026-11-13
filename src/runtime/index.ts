import type { TaskContext, TaskTarget } from '../domain';

export type TaskState = 'queued' | 'running' | 'succeeded' | 'cancelled' | 'failed' | 'stale';
export interface TaskEvent {
  id: string;
  key: string;
  label: string;
  state: TaskState;
  stage: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  target: TaskTarget;
}
export interface TaskHandle<T> { id: string; promise: Promise<T>; cancel: () => void }
export class StaleTaskError extends Error {
  constructor() { super('任务输入已改变；旧结果未应用。'); this.name = 'StaleTaskError'; }
}
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('操作已取消', 'AbortError');
}
function cancellation(): DOMException { return new DOMException('操作已取消', 'AbortError'); }

interface QueuedTask<T = unknown> {
  event: TaskEvent;
  controller: AbortController;
  run: (context: TaskContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  timeoutMs: number;
  cleanup?: () => void;
}

/** Heavy work is serial by default. Jobs produce results; callers alone commit documents. */
export class TaskScheduler {
  private queue: QueuedTask[] = [];
  private jobs = new Map<string, QueuedTask>();
  private latest = new Map<string, TaskTarget>();
  private listeners = new Set<(event: TaskEvent) => void>();
  private active = 0;
  private closed = false;
  private serial = 0;
  constructor(private readonly concurrency = 1) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Invalid task concurrency');
  }
  subscribe(listener: (event: TaskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  list(): TaskEvent[] { return [...this.jobs.values()].map(job => structuredClone(job.event)); }
  isCurrent(key: string, target: TaskTarget): boolean {
    const latest = this.latest.get(key);
    return latest?.generation === target.generation && latest.inputHash === target.inputHash && latest.projectId === target.projectId && latest.artworkId === target.artworkId && latest.targetNodeId === target.targetNodeId && latest.selectionRevision === target.selectionRevision && latest.layoutRevision === target.layoutRevision;
  }
  invalidate(key: string): void {
    this.latest.delete(key);
    for (const job of this.jobs.values()) if (job.event.key === key && (job.event.state === 'queued' || job.event.state === 'running')) job.controller.abort(cancellation());
  }
  submit<T>(options: {
    key: string;
    label: string;
    target: Omit<TaskTarget, 'generation'> & { generation?: number };
    run: (context: TaskContext) => Promise<T>;
    signal?: AbortSignal;
    timeoutMs?: number;
    replace?: boolean;
  }): TaskHandle<T> {
    if (this.closed) throw new Error('任务调度器已关闭。');
    const previous = this.latest.get(options.key);
    const generation = options.target.generation ?? (previous?.generation ?? 0) + 1;
    if (previous && generation <= previous.generation) throw new StaleTaskError();
    if (options.replace !== false) this.invalidate(options.key);
    const target: TaskTarget = { ...options.target, generation };
    this.latest.set(options.key, { ...target });
    const id = `task-${Date.now().toString(36)}-${++this.serial}`;
    const controller = new AbortController();
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    const event: TaskEvent = { id, key: options.key, label: options.label, state: 'queued', stage: '等待资源', createdAt: Date.now(), target };
    const job: QueuedTask<T> = { event, controller, run: options.run, resolve, reject, timeoutMs: options.timeoutMs ?? 120_000 };
    const onAbort = () => controller.abort(options.signal?.reason ?? cancellation());
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
      job.cleanup = () => options.signal?.removeEventListener('abort', onAbort);
    }
    this.jobs.set(id, job as QueuedTask);
    this.queue.push(job as QueuedTask);
    this.emit(event);
    queueMicrotask(() => { void this.drain(); });
    return { id, promise, cancel: () => controller.abort(cancellation()) };
  }
  cancel(id: string): void { this.jobs.get(id)?.controller.abort(cancellation()); }
  dispose(): void {
    this.closed = true;
    for (const job of this.jobs.values()) job.controller.abort(cancellation());
    this.listeners.clear();
  }
  private emit(event: TaskEvent): void {
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch { /* Observers cannot break job/resource cleanup. */ }
    }
  }
  private async drain(): Promise<void> {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.active++;
      void this.execute(job).finally(() => { this.active--; void this.drain(); });
    }
  }
  private async execute(job: QueuedTask): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      throwIfAborted(job.controller.signal);
      job.event.state = 'running';
      job.event.stage = '准备';
      job.event.startedAt = Date.now();
      this.emit(job.event);
      timeout = setTimeout(() => job.controller.abort(new DOMException('任务超时，请重试。', 'TimeoutError')), job.timeoutMs);
      const value = await job.run({ ...job.event.target, taskId: job.event.id, signal: job.controller.signal, onStage: stage => {
        if (job.controller.signal.aborted) return;
        job.event.stage = stage;
        this.emit(job.event);
      } });
      throwIfAborted(job.controller.signal);
      if (!this.isCurrent(job.event.key, job.event.target)) throw new StaleTaskError();
      job.event.state = 'succeeded';
      job.event.stage = '完成';
      job.resolve(value);
    } catch (error) {
      job.event.state = error instanceof StaleTaskError ? 'stale' : job.controller.signal.aborted ? 'cancelled' : 'failed';
      job.event.stage = job.event.state === 'cancelled' ? '已取消' : job.event.state === 'stale' ? '旧结果已丢弃' : '失败';
      job.event.error = redactDiagnostic(error instanceof Error ? error.message : String(error));
      job.reject(error);
    } finally {
      if (timeout) clearTimeout(timeout);
      job.cleanup?.();
      job.event.finishedAt = Date.now();
      this.emit(job.event);
      // Bounded diagnostic history, with pending work always preserved.
      if (this.jobs.size > 100) for (const [id, old] of this.jobs) {
        if (old.event.finishedAt && id !== job.event.id) { this.jobs.delete(id); if (this.jobs.size <= 100) break; }
      }
    }
  }
}

/** Assets referenced by documents, undo history, or running tasks cannot be reclaimed. */
export class ResourceLeases {
  private references = new Map<string, Set<string>>();
  private leases = new Map<string, number>();
  setRoot(owner: string, assetIds: Iterable<string>): void { this.references.set(owner, new Set(assetIds)); }
  removeRoot(owner: string): void { this.references.delete(owner); }
  acquire(assetIds: Iterable<string>): () => void {
    const ids = [...new Set(assetIds)];
    for (const id of ids) this.leases.set(id, (this.leases.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const id of ids) { const count = (this.leases.get(id) ?? 1) - 1; if (count) this.leases.set(id, count); else this.leases.delete(id); }
    };
  }
  retained(id: string): boolean { return (this.leases.get(id) ?? 0) > 0 || [...this.references.values()].some(root => root.has(id)); }
  collectable(ids: Iterable<string>): string[] { return [...ids].filter(id => !this.retained(id)); }
  stats(): { roots: number; leasedAssets: number; leases: number } { return { roots: this.references.size, leasedAssets: this.leases.size, leases: [...this.leases.values()].reduce((a, b) => a + b, 0) }; }
}

/** Diagnostics deliberately omit credentials, full URLs/queries and precise coordinates. */
export function redactDiagnostic(message: string): string {
  return message
    .replace(/(?:Bearer\s+|sk-)[\w.\-]+/gi, '[credential]')
    .replace(/(api[_-]?key|token|secret|authorization)\s*[:=]\s*[^\s&,;]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s)\]]+/gi, '[provider URL]')
    .replace(/-?\d{1,3}\.\d{4,}/g, '[coordinate]')
    .slice(0, 600);
}
