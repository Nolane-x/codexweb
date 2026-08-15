import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CouncilFailureCode } from "./autonomy-errors";
import type { AutonomyWorkKind } from "./autonomy-work-store";

export interface CouncilAutonomyPolicy {
  maxManagedTurnsPerProjectHour: number;
  maxAutomaticWakesPerTargetHour: number;
  maxAutomaticSpawnsPerProjectHour: number;
  maxConsecutiveRecoveryAttempts: number;
  maxActiveItemsPerProject: number;
  equivalentWakeCooldownMs: number;
  maxCorrelationDepth: number;
  maxQueuedAgeMs: number;
}

export const DEFAULT_COUNCIL_AUTONOMY_POLICY: Readonly<CouncilAutonomyPolicy> = Object.freeze({
  maxManagedTurnsPerProjectHour: 60,
  maxAutomaticWakesPerTargetHour: 12,
  maxAutomaticSpawnsPerProjectHour: 6,
  maxConsecutiveRecoveryAttempts: 6,
  maxActiveItemsPerProject: 200,
  equivalentWakeCooldownMs: 60_000,
  maxCorrelationDepth: 12,
  maxQueuedAgeMs: 6 * 60 * 60 * 1_000,
});

export type CouncilBudgetEventType = "managed-turn" | "wake" | "spawn";
export interface CouncilBudgetEvent {
  at: string;
  projectRoomId: string;
  type: CouncilBudgetEventType;
  targetAgentId?: string;
}
interface BudgetStateFile { version: 1; events: CouncilBudgetEvent[] }

export interface CouncilAutonomyIntentCheck {
  projectRoomId: string;
  kind: AutonomyWorkKind;
  targetAgentId?: string;
  activeItems: number;
  correlationDepth: number;
  consecutiveRecoveryAttempts?: number;
  equivalentLastAt?: string;
  createdAt?: string;
}

export interface CouncilPolicyDecision {
  allowed: boolean;
  code?: CouncilFailureCode;
  reason?: string;
}

function validId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

export class CouncilAutonomyBudgetLedger {
  private state: BudgetStateFile;
  private readonly path: string;
  private readonly now: () => number;
  readonly policy: Readonly<CouncilAutonomyPolicy>;

  constructor(path: string, options: { now?: () => number; policy?: Partial<CouncilAutonomyPolicy> } = {}) {
    this.path = path;
    this.now = options.now ?? Date.now;
    this.policy = Object.freeze({ ...DEFAULT_COUNCIL_AUTONOMY_POLICY, ...(options.policy ?? {}) });
    this.state = this.load();
    this.prune();
  }

  checkIntent(input: CouncilAutonomyIntentCheck): CouncilPolicyDecision {
    const room = validId(input.projectRoomId, "projectRoomId");
    const target = input.targetAgentId ? validId(input.targetAgentId, "targetAgentId") : undefined;
    this.prune();
    if (input.activeItems > this.policy.maxActiveItemsPerProject) return this.denied("active durable work limit reached");
    if (input.correlationDepth > this.policy.maxCorrelationDepth) return this.denied("autonomous correlation depth exceeded");
    if ((input.consecutiveRecoveryAttempts ?? 0) >= this.policy.maxConsecutiveRecoveryAttempts) return this.denied("agent recovery attempt limit reached");
    if (input.createdAt && this.now() - new Date(input.createdAt).getTime() > this.policy.maxQueuedAgeMs) return { allowed: false, code: "WORK_ITEM_STALE", reason: "queued work exceeded maximum age" };
    if (input.equivalentLastAt && this.now() - new Date(input.equivalentLastAt).getTime() < this.policy.equivalentWakeCooldownMs) return this.denied("equivalent wake cooldown is active");

    const hour = this.now() - 60 * 60 * 1_000;
    const projectEvents = this.state.events.filter(event => event.projectRoomId === room && new Date(event.at).getTime() >= hour);
    const turns = projectEvents.filter(event => event.type === "managed-turn").length;
    if (turns >= this.policy.maxManagedTurnsPerProjectHour) return this.denied("managed turn hourly budget exhausted");
    if (input.kind === "wake" || input.kind === "task-route" || input.kind === "review-route") {
      const wakes = projectEvents.filter(event => event.type === "wake" && event.targetAgentId === target).length;
      if (target && wakes >= this.policy.maxAutomaticWakesPerTargetHour) return this.denied("automatic wake hourly budget exhausted for target");
    }
    if (input.kind === "spawn") {
      const spawns = projectEvents.filter(event => event.type === "spawn").length;
      if (spawns >= this.policy.maxAutomaticSpawnsPerProjectHour) return this.denied("automatic spawn hourly budget exhausted");
    }
    return { allowed: true };
  }

  recordExecution(input: { projectRoomId: string; type: CouncilBudgetEventType; targetAgentId?: string }): CouncilBudgetEvent {
    const event: CouncilBudgetEvent = {
      at: new Date(this.now()).toISOString(),
      projectRoomId: validId(input.projectRoomId, "projectRoomId"),
      type: input.type,
      ...(input.targetAgentId ? { targetAgentId: validId(input.targetAgentId, "targetAgentId") } : {}),
    };
    this.state.events.push(event);
    this.prune();
    this.write();
    return structuredClone(event);
  }

  utilization(projectRoomId: string): { managedTurns: number; spawns: number; wakesByTarget: Record<string, number>; policy: Readonly<CouncilAutonomyPolicy> } {
    const room = validId(projectRoomId, "projectRoomId");
    this.prune();
    const hour = this.now() - 60 * 60 * 1_000;
    const events = this.state.events.filter(event => event.projectRoomId === room && new Date(event.at).getTime() >= hour);
    const wakesByTarget: Record<string, number> = {};
    for (const event of events) if (event.type === "wake" && event.targetAgentId) wakesByTarget[event.targetAgentId] = (wakesByTarget[event.targetAgentId] ?? 0) + 1;
    return {
      managedTurns: events.filter(event => event.type === "managed-turn").length,
      spawns: events.filter(event => event.type === "spawn").length,
      wakesByTarget,
      policy: this.policy,
    };
  }

  private denied(reason: string): CouncilPolicyDecision { return { allowed: false, code: "POLICY_BUDGET_EXHAUSTED", reason }; }

  private prune(): void {
    const cutoff = this.now() - 2 * 60 * 60 * 1_000;
    this.state.events = this.state.events.filter(event => new Date(event.at).getTime() >= cutoff).slice(-5_000);
  }

  private load(): BudgetStateFile {
    if (!existsSync(this.path)) return { version: 1, events: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as BudgetStateFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.events)) throw new Error("invalid budget state");
      return parsed;
    } catch (error) {
      try { renameSync(this.path, `${this.path}.corrupt-${Date.now()}`); } catch {}
      throw new Error(`Council autonomy budget state is corrupt and was quarantined: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private write(): void {
    const directory = dirname(this.path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { chmodSync(directory, 0o700); } catch {}
    const temp = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      renameSync(temp, this.path);
      try { chmodSync(this.path, 0o600); } catch {}
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }
}
