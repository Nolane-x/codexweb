import type { CouncilStore } from "./store";
import { isActiveCouncilWake } from "./store";
import type { CouncilAutonomyWorkStore, AutonomyWorkKind, AutonomyWorkState } from "./autonomy-work-store";

export type ManagedRuntimeStatus = "active" | "sleeping" | "queued" | "failed";

export interface CouncilAutonomyRouterOptions {
  council: CouncilStore;
  work: CouncilAutonomyWorkStore;
  managedAgentIds: () => Set<string>;
  managedStatus: (agentId: string) => ManagedRuntimeStatus | undefined;
  scanIntervalMs?: number;
}

const ACTIVE_WORK = new Set<AutonomyWorkState>(["queued", "leased", "running", "retry-wait"]);

export class CouncilAutonomyRouter {
  private readonly council: CouncilStore;
  private readonly work: CouncilAutonomyWorkStore;
  private readonly managedAgentIds: () => Set<string>;
  private readonly managedStatus: (agentId: string) => ManagedRuntimeStatus | undefined;
  private readonly scanIntervalMs: number;
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private scanning = false;
  private scanRequested = false;

  constructor(options: CouncilAutonomyRouterOptions) {
    this.council = options.council;
    this.work = options.work;
    this.managedAgentIds = options.managedAgentIds;
    this.managedStatus = options.managedStatus;
    this.scanIntervalMs = Math.max(5_000, options.scanIntervalMs ?? 15_000);
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
    if (this.scanning) {
      this.scanRequested = true;
      return;
    }
    this.scanning = true;
    try {
      const snapshot = this.council.snapshot();
      const managed = this.managedAgentIds();

      // First import all already-created active wakes. This is the Council 3.4 migration path and
      // also repairs the crash window where a wake was persisted before its durable work item.
      for (const wake of snapshot.wakes) {
        if (!managed.has(wake.targetAgentId) || !isActiveCouncilWake(wake)) continue;
        const alreadyRouted = this.work.snapshot().items.some(item => item.wakeId === wake.id && ACTIVE_WORK.has(item.state));
        if (alreadyRouted) continue;
        const dedupeKey = `wake:${wake.roomId}:${wake.targetAgentId}:event:${wake.id}`;
        if (this.work.active(dedupeKey)) continue;
        this.work.enqueue({
          kind: "wake",
          projectRoomId: wake.roomId,
          targetAgentId: wake.targetAgentId,
          sourceAgentId: wake.sourceAgentId,
          wakeId: wake.id,
          dedupeKey,
          priority: 95,
          maxAttempts: 6,
          reason: wake.reason,
        });
      }

      for (const task of snapshot.tasks) {
        if (task.status === "done" || !task.assigneeAgentId || !managed.has(task.assigneeAgentId)) continue;
        if (this.managedStatus(task.assigneeAgentId) === "active") continue;
        const review = task.status === "review";
        const kind: AutonomyWorkKind = review ? "review-route" : "task-route";
        const dedupeKey = review
          ? `review:${task.roomId}:${task.assigneeAgentId}:${task.id}`
          : `wake:${task.roomId}:${task.assigneeAgentId}:task:${task.id}`;
        if (this.work.active(dedupeKey)) continue;
        const reason = review
          ? `Review task ${task.id}: ${task.title}`
          : `Continue assigned task ${task.id}: ${task.title}`;
        const wake = this.createWakeSafely({
          targetAgentId: task.assigneeAgentId,
          roomId: task.roomId,
          sourceAgentId: task.createdByAgentId,
          reason,
        });
        if (!wake) continue;
        this.work.enqueue({
          kind,
          projectRoomId: task.roomId,
          targetAgentId: task.assigneeAgentId,
          sourceAgentId: task.createdByAgentId,
          taskId: task.id,
          wakeId: wake.id,
          dedupeKey,
          priority: review ? 92 : 85,
          maxAttempts: 6,
          reason,
        });
      }

      for (const message of snapshot.messages.slice(-300)) {
        if (!message.mentions.length || !message.body.trim()) continue;
        for (const targetAgentId of message.mentions) {
          if (!managed.has(targetAgentId) || targetAgentId === message.authorAgentId || this.managedStatus(targetAgentId) === "active") continue;
          const dedupeKey = `mention:${message.roomId}:${targetAgentId}:${message.id}`;
          if (this.work.active(dedupeKey)) continue;
          const wake = this.createWakeSafely({
            targetAgentId,
            roomId: message.roomId,
            sourceAgentId: message.authorAgentId,
            sourceMessageId: message.id,
            reason: `You were mentioned in Council message ${message.id}. Read the current room state and respond only if action is required.`,
          });
          if (!wake) continue;
          this.work.enqueue({
            kind: "wake",
            projectRoomId: message.roomId,
            targetAgentId,
            sourceAgentId: message.authorAgentId,
            wakeId: wake.id,
            dedupeKey,
            priority: 75,
            maxAttempts: 5,
            reason: `Mentioned in Council message ${message.id}`,
          });
        }
      }
    } finally {
      this.scanning = false;
      if (this.scanRequested) {
        this.scanRequested = false;
        this.scan();
      }
    }
  }

  private createWakeSafely(input: { targetAgentId: string; roomId: string; reason: string; sourceAgentId?: string; sourceMessageId?: string }) {
    try { return this.council.wake(input); }
    catch (error) {
      // Capacity/cooldown means another durable/active wake already owns the near-term turn. The
      // periodic scan will revisit the task after that wake transitions; never manufacture a storm.
      if (error instanceof Error && /wake queue.*full|wake cooldown/i.test(error.message)) return undefined;
      throw error;
    }
  }
}
