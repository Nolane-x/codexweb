import type { CouncilStore } from "./store";

export interface CouncilStaleThresholds {
  claimed: number;
  in_progress: number;
  review: number;
  blocked: number;
}
export const DEFAULT_COUNCIL_STALE_THRESHOLDS_MS: Readonly<CouncilStaleThresholds> = Object.freeze({
  claimed: 30 * 60 * 1_000,
  in_progress: 30 * 60 * 1_000,
  review: 20 * 60 * 1_000,
  blocked: 60 * 60 * 1_000,
});

export interface StaleEscalationInput {
  taskId: string;
  taskUpdatedAt: string;
  roomId: string;
  assigneeAgentId: string;
  managerAgentId: string;
  status: "claimed" | "in_progress" | "review" | "blocked";
  reason: string;
}

function taskRevisionKey(task: { id: string; updatedAt: string; status: string; assigneeAgentId?: string }): string {
  return `${task.id}:${task.updatedAt}:${task.status}:${task.assigneeAgentId ?? ""}`;
}

export class CouncilStaleWorkMonitor {
  private readonly council: CouncilStore;
  private readonly managedAgentIds: () => Set<string>;
  private readonly managedStatus: (agentId: string) => "active" | "sleeping" | "queued" | "failed" | undefined;
  private readonly managerAgentId: () => string | null | undefined;
  private readonly enqueueEscalation: (input: StaleEscalationInput) => void | Promise<void>;
  private readonly thresholds: CouncilStaleThresholds;
  private readonly now: () => number;
  private readonly seen = new Set<string>();
  private readonly scanIntervalMs: number;
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private scanning = false;
  private requested = false;

  constructor(options: {
    council: CouncilStore;
    managedAgentIds: () => Set<string>;
    managedStatus: (agentId: string) => "active" | "sleeping" | "queued" | "failed" | undefined;
    managerAgentId: () => string | null | undefined;
    enqueueEscalation: (input: StaleEscalationInput) => void | Promise<void>;
    thresholdsMs?: Partial<CouncilStaleThresholds>;
    now?: () => number;
    scanIntervalMs?: number;
  }) {
    this.council = options.council;
    this.managedAgentIds = options.managedAgentIds;
    this.managedStatus = options.managedStatus;
    this.managerAgentId = options.managerAgentId;
    this.enqueueEscalation = options.enqueueEscalation;
    this.thresholds = { ...DEFAULT_COUNCIL_STALE_THRESHOLDS_MS, ...(options.thresholdsMs ?? {}) };
    this.now = options.now ?? Date.now;
    this.scanIntervalMs = Math.max(30_000, options.scanIntervalMs ?? 60_000);
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.council.onMutation(() => this.scan());
    this.timer = setInterval(() => this.scan(), this.scanIntervalMs);
    this.timer.unref?.();
    this.scan();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  scan(): void {
    if (this.scanning) { this.requested = true; return; }
    this.scanning = true;
    try {
      const manager = this.managerAgentId();
      if (!manager) return;
      const managed = this.managedAgentIds();
      const now = this.now();
      for (const task of this.council.snapshot().tasks) {
        if (!task.assigneeAgentId || !managed.has(task.assigneeAgentId)) continue;
        if (task.status !== "claimed" && task.status !== "in_progress" && task.status !== "review" && task.status !== "blocked") continue;
        if (this.managedStatus(task.assigneeAgentId) === "active") continue;
        const threshold = this.thresholds[task.status];
        if (now - new Date(task.updatedAt).getTime() < threshold) continue;
        const revisionKey = taskRevisionKey(task);
        if (this.seen.has(revisionKey)) continue;
        this.seen.add(revisionKey);
        void Promise.resolve(this.enqueueEscalation({
          taskId: task.id,
          taskUpdatedAt: task.updatedAt,
          roomId: task.roomId,
          assigneeAgentId: task.assigneeAgentId,
          managerAgentId: manager,
          status: task.status,
          reason: `Task ${task.id} has remained ${task.status} without an update beyond the configured stale threshold`,
        })).catch(() => { this.seen.delete(revisionKey); });
      }
      if (this.seen.size > 10_000) {
        const activeRevisions = new Set(this.council.snapshot().tasks.map(taskRevisionKey));
        for (const key of this.seen) if (!activeRevisions.has(key)) this.seen.delete(key);
      }
    } finally {
      this.scanning = false;
      if (this.requested) { this.requested = false; this.scan(); }
    }
  }
}
