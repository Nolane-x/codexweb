export interface CouncilWorkRetryPolicy {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryable?: (error: unknown) => boolean;
}

export interface CouncilWorkSchedulerSnapshot {
  active: string | null;
  queued: number;
  completed: number;
  failed: number;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value!));
}

/**
 * A deliberately small FIFO scheduler for browser-affecting Council work.
 * It serializes work globally so a wake storm cannot fan out several ChatGPT
 * automations at once. Retry is opt-in and intended only for failures that are
 * known to happen before a message is submitted.
 */
export class CouncilWorkScheduler {
  private tail: Promise<unknown> = Promise.resolve();
  private active: string | null = null;
  private queued = 0;
  private completed = 0;
  private failed = 0;
  private stopped = false;

  snapshot(): CouncilWorkSchedulerSnapshot {
    return { active: this.active, queued: this.queued, completed: this.completed, failed: this.failed };
  }

  stop(): void { this.stopped = true; }
  start(): void { this.stopped = false; }

  enqueue<T>(label: string, work: (attempt: number) => Promise<T>, policy: CouncilWorkRetryPolicy = {}): Promise<T> {
    const name = label.trim().slice(0, 200);
    if (!name) return Promise.reject(new Error("Council scheduled work requires a label"));
    if (this.stopped) return Promise.reject(new Error("Council work scheduler is stopped"));
    this.queued += 1;
    const previous = this.tail;
    const next = previous.catch(() => {}).then(async () => {
      this.queued = Math.max(0, this.queued - 1);
      if (this.stopped) throw new Error("Council work scheduler is stopped");
      this.active = name;
      const attempts = boundedInteger(policy.attempts, 1, 1, 20);
      const baseDelayMs = boundedInteger(policy.baseDelayMs, 250, 0, 60_000);
      const maxDelayMs = boundedInteger(policy.maxDelayMs, 5_000, baseDelayMs, 120_000);
      try {
        for (let attempt = 1; ; attempt++) {
          try {
            const value = await work(attempt);
            this.completed += 1;
            return value;
          } catch (error) {
            if (attempt >= attempts || policy.retryable?.(error) !== true) {
              this.failed += 1;
              throw error;
            }
            const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
            const jitter = Math.min(250, Math.floor(exponential * 0.1));
            await sleep(exponential + (jitter ? Math.floor(Math.random() * (jitter + 1)) : 0));
          }
        }
      } finally {
        this.active = null;
      }
    });
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }

  async idle(): Promise<void> { await this.tail; }
}
