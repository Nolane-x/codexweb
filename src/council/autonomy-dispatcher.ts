import { randomUUID } from "node:crypto";
import type { CouncilExecutionPhase, CouncilFailureCode } from "./autonomy-errors";
import { boundedFailureMessage, classifyCouncilFailure, councilPhaseReached } from "./autonomy-errors";
import type { CouncilAutonomyAuditStore } from "./autonomy-audit";
import type { CouncilAutonomyBudgetLedger } from "./autonomy-policy";
import type { AutonomyWorkItem, CouncilAutonomyWorkStore } from "./autonomy-work-store";
import type { CouncilAgentHealthLedger } from "./agent-health";

export interface CouncilAutonomyExecutionHooks {
  onPhase: (phase: CouncilExecutionPhase) => void;
}

export interface CouncilAutonomyDispatcherOptions {
  work: CouncilAutonomyWorkStore;
  audit: CouncilAutonomyAuditStore;
  health: CouncilAgentHealthLedger;
  budget: CouncilAutonomyBudgetLedger;
  execute: (item: AutonomyWorkItem, hooks: CouncilAutonomyExecutionHooks) => Promise<void>;
  onEscalationNeeded?: (item: AutonomyWorkItem, code: CouncilFailureCode, reason: string) => void | Promise<void>;
  now?: () => number;
  random?: () => number;
  leaseMs?: number;
  heartbeatMs?: number;
}

export interface CouncilAutonomyDispatcherSnapshot {
  running: boolean;
  activeWorkItemId: string | null;
  queued: number;
  retryWait: number;
  uncertain: number;
  failed: number;
  completed: number;
}

const ACTIVE_STATES = new Set(["queued", "leased", "running", "retry-wait"]);

export class CouncilAutonomyDispatcher {
  private readonly work: CouncilAutonomyWorkStore;
  private readonly audit: CouncilAutonomyAuditStore;
  private readonly health: CouncilAgentHealthLedger;
  private readonly budget: CouncilAutonomyBudgetLedger;
  private readonly executeWork: CouncilAutonomyDispatcherOptions["execute"];
  private readonly onEscalationNeeded?: CouncilAutonomyDispatcherOptions["onEscalationNeeded"];
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly owner = `dispatcher_${randomUUID().replaceAll("-", "")}`;
  private started = false;
  private stopping = false;
  private activeWorkItemId: string | null = null;
  private loopPromise?: Promise<void>;
  private wakeResolver?: () => void;
  private readonly unsubscribe: () => void;

  constructor(options: CouncilAutonomyDispatcherOptions) {
    this.work = options.work;
    this.audit = options.audit;
    this.health = options.health;
    this.budget = options.budget;
    this.executeWork = options.execute;
    this.onEscalationNeeded = options.onEscalationNeeded;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.leaseMs = Math.max(5_000, options.leaseMs ?? 30_000);
    this.heartbeatMs = Math.max(1_000, Math.min(this.leaseMs / 2, options.heartbeatMs ?? 10_000));
    this.unsubscribe = this.work.onMutation(() => this.kick());
  }

  snapshot(): CouncilAutonomyDispatcherSnapshot {
    const items = this.work.snapshot().items;
    const count = (state: string) => items.filter(item => item.state === state).length;
    return {
      running: this.started && !this.stopping,
      activeWorkItemId: this.activeWorkItemId,
      queued: count("queued"),
      retryWait: count("retry-wait"),
      uncertain: count("uncertain"),
      failed: count("failed"),
      completed: count("completed"),
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    const before = new Map(this.work.snapshot().items.map(item => [item.id, item.state]));
    this.work.recoverExpiredLeases();
    for (const item of this.work.snapshot().items) {
      const previous = before.get(item.id);
      if ((previous === "leased" || previous === "running") && previous !== item.state) {
        this.audit.append({
          correlationId: item.correlationId,
          workItemId: item.id,
          kind: item.kind,
          transition: item.state === "uncertain" ? "uncertain" : "recovered-after-restart",
          ...(item.sourceAgentId ? { sourceAgentId: item.sourceAgentId } : {}),
          ...(item.targetAgentId ? { targetAgentId: item.targetAgentId } : {}),
          ...(item.taskId ? { taskId: item.taskId } : {}),
          ...(item.failureCode ? { code: item.failureCode } : {}),
          reason: item.failureMessage,
        });
      }
    }
    this.loopPromise = this.loop();
    this.kick();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.started = false;
    this.kick();
    await this.loopPromise?.catch(() => {});
    this.loopPromise = undefined;
  }

  dispose(): void {
    this.unsubscribe();
    this.kick();
  }

  kick(): void {
    const resolve = this.wakeResolver;
    this.wakeResolver = undefined;
    resolve?.();
  }

  async idle(): Promise<void> {
    while (this.activeWorkItemId) await new Promise(resolve => setTimeout(resolve, 10));
  }

  async runOnce(): Promise<boolean> {
    const leased = this.work.leaseNext(this.owner, this.leaseMs);
    if (!leased) return false;
    this.activeWorkItemId = leased.id;
    this.auditEvent(leased, "leased");

    const healthGate = leased.targetAgentId ? this.health.canAttempt(leased.targetAgentId) : { allowed: true as const };
    if (!healthGate.allowed) {
      const code = healthGate.reasonCode ?? "UNKNOWN";
      if (healthGate.retryAt) {
        this.work.defer(leased.id, this.owner, { notBefore: healthGate.retryAt, code, message: "target agent circuit breaker cooldown is active" });
        this.auditEvent(leased, "policy-blocked", code, "target agent circuit breaker cooldown is active");
        if (code === "CHATGPT_LIMITED" || code === "RESPONSE_STALLED") this.escalate(leased, code, "target agent circuit breaker cooldown is active");
      } else {
        this.work.fail(leased.id, this.owner, code, "target agent circuit breaker is open");
        this.auditEvent(leased, "policy-blocked", code, "target agent circuit breaker is open");
        this.escalate(leased, code, "target agent circuit breaker is open");
      }
      this.activeWorkItemId = null;
      return true;
    }

    const snapshot = this.work.snapshot();
    const activeItems = snapshot.items.filter(item => ACTIVE_STATES.has(item.state)).length;
    const decision = this.budget.checkIntent({
      projectRoomId: leased.projectRoomId,
      kind: leased.kind,
      targetAgentId: leased.targetAgentId,
      activeItems,
      correlationDepth: leased.correlationDepth,
      consecutiveRecoveryAttempts: Math.max(0, leased.attempt - 1),
      createdAt: leased.createdAt,
    });
    if (!decision.allowed) {
      const code = decision.code ?? "POLICY_BUDGET_EXHAUSTED";
      this.work.fail(leased.id, this.owner, code, decision.reason);
      this.auditEvent(leased, "policy-blocked", code, decision.reason);
      this.escalate(leased, code, decision.reason ?? "autonomy policy blocked work");
      this.activeWorkItemId = null;
      return true;
    }

    this.work.markRunning(leased.id, this.owner);
    this.auditEvent(leased, "running");
    this.recordBudget(leased);
    if (leased.targetAgentId) this.health.observeSupervisor(leased.targetAgentId, "busy", "durable Council work is running");

    const heartbeat = setInterval(() => {
      try { this.work.heartbeatLease(leased.id, this.owner, this.leaseMs); }
      catch { /* Dispatcher completion/recovery owns the authoritative transition. */ }
    }, this.heartbeatMs);
    heartbeat.unref?.();

    try {
      await this.executeWork(leased, {
        onPhase: phase => {
          this.work.recordPhase(leased.id, this.owner, phase);
          this.auditEvent(leased, "phase", undefined, phase);
        },
      });
      this.work.complete(leased.id, this.owner);
      if (leased.targetAgentId) this.health.observeSuccess(leased.targetAgentId, "dispatcher");
      this.auditEvent(leased, "completed");
    } catch (error) {
      const classification = classifyCouncilFailure(error);
      const persisted = this.work.snapshot().items.find(item => item.id === leased.id);
      const message = boundedFailureMessage(error);
      if (councilPhaseReached(persisted?.lastPhase, "submit-started")) {
        this.work.uncertain(leased.id, this.owner, message);
        if (leased.targetAgentId) this.health.observeFailure(leased.targetAgentId, "SUBMISSION_UNCERTAIN", message, "dispatcher");
        this.auditEvent(leased, "uncertain", "SUBMISSION_UNCERTAIN", message);
        this.escalate(leased, "SUBMISSION_UNCERTAIN", message);
      } else if (classification.retryableBeforeSubmit && leased.attempt < leased.maxAttempts) {
        const exponential = Math.min(60_000, 1_000 * (2 ** Math.max(0, leased.attempt - 1)));
        const jitter = Math.floor(exponential * 0.1 * Math.max(0, Math.min(1, this.random())));
        let retryAtMs = this.now() + exponential + jitter;
        if (leased.targetAgentId) {
          this.health.observeFailure(leased.targetAgentId, classification.code, message, "dispatcher");
          const breaker = this.health.canAttempt(leased.targetAgentId);
          if (!breaker.allowed && breaker.retryAt) retryAtMs = Math.max(retryAtMs, Date.parse(breaker.retryAt));
        }
        this.work.retry(leased.id, this.owner, { notBefore: new Date(retryAtMs).toISOString(), code: classification.code, message });
        this.auditEvent(leased, "retry", classification.code, message);
      } else {
        this.work.fail(leased.id, this.owner, classification.code, message);
        if (leased.targetAgentId) this.health.observeFailure(leased.targetAgentId, classification.code, message, "dispatcher");
        this.auditEvent(leased, "failed", classification.code, message);
        if (classification.code === "CHATGPT_LIMITED" || classification.code === "CHATGPT_SIGNED_OUT" || classification.code === "RESPONSE_STALLED" || classification.code === "CONVERSATION_UNAVAILABLE") {
          this.escalate(leased, classification.code, message);
        }
      }
    } finally {
      clearInterval(heartbeat);
      this.activeWorkItemId = null;
    }
    return true;
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      const didWork = await this.runOnce().catch(() => false);
      if (this.stopping) break;
      if (didWork) continue;
      await new Promise<void>(resolve => {
        let settled = false;
        const finish = () => { if (settled) return; settled = true; clearTimeout(timer); if (this.wakeResolver === finish) this.wakeResolver = undefined; resolve(); };
        const timer = setTimeout(finish, 1_000);
        timer.unref?.();
        this.wakeResolver = finish;
      });
    }
  }

  private escalate(item: AutonomyWorkItem, code: CouncilFailureCode, reason: string): void {
    if (!this.onEscalationNeeded || item.kind === "escalation") return;
    void Promise.resolve(this.onEscalationNeeded(item, code, reason)).catch(() => {});
  }

  private recordBudget(item: AutonomyWorkItem): void {
    if (item.kind === "spawn") {
      this.budget.recordExecution({ projectRoomId: item.projectRoomId, type: "spawn", ...(item.targetAgentId ? { targetAgentId: item.targetAgentId } : {}) });
      this.budget.recordExecution({ projectRoomId: item.projectRoomId, type: "managed-turn", ...(item.targetAgentId ? { targetAgentId: item.targetAgentId } : {}) });
      return;
    }
    if (item.kind === "wake" || item.kind === "task-route" || item.kind === "review-route") {
      this.budget.recordExecution({ projectRoomId: item.projectRoomId, type: "wake", ...(item.targetAgentId ? { targetAgentId: item.targetAgentId } : {}) });
      this.budget.recordExecution({ projectRoomId: item.projectRoomId, type: "managed-turn", ...(item.targetAgentId ? { targetAgentId: item.targetAgentId } : {}) });
      return;
    }
    if (item.kind === "manager-observation" || item.kind === "escalation") {
      this.budget.recordExecution({ projectRoomId: item.projectRoomId, type: "managed-turn", ...(item.targetAgentId ? { targetAgentId: item.targetAgentId } : {}) });
    }
  }

  private auditEvent(item: AutonomyWorkItem, transition: Parameters<CouncilAutonomyAuditStore["append"]>[0]["transition"], code?: Parameters<CouncilAutonomyAuditStore["append"]>[0]["code"], reason?: string): void {
    this.audit.append({
      correlationId: item.correlationId,
      workItemId: item.id,
      kind: item.kind,
      transition,
      ...(item.sourceAgentId ? { sourceAgentId: item.sourceAgentId } : {}),
      ...(item.targetAgentId ? { targetAgentId: item.targetAgentId } : {}),
      ...(item.taskId ? { taskId: item.taskId } : {}),
      ...(item.wakeId ? { wakeId: item.wakeId } : {}),
      ...(code ? { code } : {}),
      ...(reason ? { reason } : {}),
    });
  }
}
