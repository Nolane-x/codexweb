import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CouncilExecutionPhase, CouncilFailureCode } from "./autonomy-errors";
import { councilPhaseReached } from "./autonomy-errors";

export type AutonomyWorkKind = "wake" | "spawn" | "manager-observation" | "capture" | "task-route" | "review-route" | "escalation";
export type AutonomyWorkState = "queued" | "leased" | "running" | "retry-wait" | "uncertain" | "completed" | "failed" | "cancelled";

export interface AutonomyWorkItem {
  id: string;
  kind: AutonomyWorkKind;
  projectRoomId: string;
  targetAgentId?: string;
  sourceAgentId?: string;
  taskId?: string;
  wakeId?: string;
  dedupeKey: string;
  priority: number;
  state: AutonomyWorkState;
  attempt: number;
  maxAttempts: number;
  correlationDepth: number;
  notBefore: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastPhase?: CouncilExecutionPhase;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failureCode?: CouncilFailureCode;
  failureMessage?: string;
  correlationId: string;
  reasons: string[];
}

export interface EnqueueAutonomyWorkInput {
  kind: AutonomyWorkKind;
  projectRoomId: string;
  targetAgentId?: string;
  sourceAgentId?: string;
  taskId?: string;
  wakeId?: string;
  dedupeKey: string;
  priority?: number;
  maxAttempts?: number;
  correlationDepth?: number;
  notBefore?: string;
  correlationId?: string;
  reason?: string;
}

interface WorkStateFile { version: 1; revision: number; items: AutonomyWorkItem[] }
export interface CouncilAutonomyWorkSnapshot { version: 1; revision: number; items: AutonomyWorkItem[] }

const TERMINAL = new Set<AutonomyWorkState>(["uncertain", "completed", "failed", "cancelled"]);

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isInteger(value) ? Math.max(min, Math.min(max, value!)) : fallback;
}

function safeId(value: string | undefined, name: string, max = 160): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) throw new Error(`${name} is invalid`);
  return normalized;
}

function safeText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
  return normalized || undefined;
}

function safeDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function clone<T>(value: T): T { return structuredClone(value); }

export class CouncilAutonomyWorkStore {
  private state: WorkStateFile;
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly listeners = new Set<(revision: number) => void>();

  constructor(filePath: string, options: { now?: () => number } = {}) {
    this.filePath = filePath;
    this.now = options.now ?? Date.now;
    this.state = this.load();
  }

  snapshot(): CouncilAutonomyWorkSnapshot { return clone(this.state); }

  onMutation(listener: (revision: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  active(dedupeKey: string): AutonomyWorkItem | undefined {
    const key = dedupeKey.trim();
    const item = this.state.items.find(candidate => candidate.dedupeKey === key && !TERMINAL.has(candidate.state));
    return item ? clone(item) : undefined;
  }

  enqueue(input: EnqueueAutonomyWorkInput): AutonomyWorkItem {
    const now = this.isoNow();
    const dedupeKey = input.dedupeKey.trim().slice(0, 300);
    if (!dedupeKey) throw new Error("autonomy work dedupeKey is required");
    const existing = this.state.items.find(item => item.dedupeKey === dedupeKey && !TERMINAL.has(item.state));
    if (existing) {
      existing.priority = Math.max(existing.priority, boundedInteger(input.priority, existing.priority, 0, 100));
      existing.maxAttempts = Math.max(existing.maxAttempts, boundedInteger(input.maxAttempts, existing.maxAttempts, 1, 20));
      existing.correlationDepth = Math.min(existing.correlationDepth, boundedInteger(input.correlationDepth, existing.correlationDepth, 0, 64));
      const reason = safeText(input.reason, 300);
      if (reason && !existing.reasons.includes(reason)) existing.reasons = [...existing.reasons, reason].slice(-8);
      existing.updatedAt = now;
      this.persistMutation();
      return clone(existing);
    }
    const targetAgentId = safeId(input.targetAgentId, "targetAgentId", 128);
    const sourceAgentId = safeId(input.sourceAgentId, "sourceAgentId", 128);
    const taskId = safeId(input.taskId, "taskId", 128);
    const wakeId = safeId(input.wakeId, "wakeId", 128);
    const reason = safeText(input.reason, 300);
    const item: AutonomyWorkItem = {
      id: `work_${randomUUID().replaceAll("-", "")}`,
      kind: input.kind,
      projectRoomId: safeId(input.projectRoomId, "projectRoomId", 128)!,
      ...(targetAgentId ? { targetAgentId } : {}),
      ...(sourceAgentId ? { sourceAgentId } : {}),
      ...(taskId ? { taskId } : {}),
      ...(wakeId ? { wakeId } : {}),
      dedupeKey,
      priority: boundedInteger(input.priority, 50, 0, 100),
      state: "queued",
      attempt: 0,
      maxAttempts: boundedInteger(input.maxAttempts, 4, 1, 20),
      correlationDepth: boundedInteger(input.correlationDepth, 0, 0, 64),
      notBefore: safeDate(input.notBefore, now),
      createdAt: now,
      updatedAt: now,
      correlationId: safeId(input.correlationId, "correlationId", 160) ?? `corr_${randomUUID().replaceAll("-", "")}`,
      reasons: reason ? [reason] : [],
    };
    this.state.items.push(item);
    this.persistMutation();
    return clone(item);
  }

  leaseNext(owner: string, leaseMs = 30_000): AutonomyWorkItem | undefined {
    const leaseOwner = safeId(owner, "leaseOwner", 160)!;
    const nowMs = this.now();
    const eligible = this.state.items
      .filter(item => (item.state === "queued" || item.state === "retry-wait") && new Date(item.notBefore).getTime() <= nowMs)
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const item = eligible[0];
    if (!item) return undefined;
    item.state = "leased";
    item.leaseOwner = leaseOwner;
    item.leaseExpiresAt = new Date(nowMs + Math.max(1_000, leaseMs)).toISOString();
    item.attempt += 1;
    item.updatedAt = this.isoNow();
    this.persistMutation();
    return clone(item);
  }

  markRunning(id: string, owner: string): AutonomyWorkItem {
    return this.withLease(id, owner, item => { item.state = "running"; });
  }

  heartbeatLease(id: string, owner: string, leaseMs = 30_000): AutonomyWorkItem {
    return this.withLease(id, owner, item => { item.leaseExpiresAt = new Date(this.now() + Math.max(1_000, leaseMs)).toISOString(); });
  }

  recordPhase(id: string, owner: string, phase: CouncilExecutionPhase): AutonomyWorkItem {
    return this.withLease(id, owner, item => { item.lastPhase = phase; });
  }

  complete(id: string, owner: string): AutonomyWorkItem {
    return this.withLease(id, owner, item => {
      item.state = "completed";
      item.completedAt = this.isoNow();
      this.clearLease(item);
      delete item.failureCode;
      delete item.failureMessage;
    });
  }

  retry(id: string, owner: string, input: { notBefore: string; code?: CouncilFailureCode; message?: string }): AutonomyWorkItem {
    return this.withLease(id, owner, item => {
      item.state = "retry-wait";
      item.notBefore = safeDate(input.notBefore, this.isoNow());
      if (input.code) item.failureCode = input.code;
      const message = safeText(input.message, 500);
      if (message) item.failureMessage = message;
      this.clearLease(item);
    });
  }

  defer(id: string, owner: string, input: { notBefore: string; code?: CouncilFailureCode; message?: string }): AutonomyWorkItem {
    return this.withLease(id, owner, item => {
      item.state = "retry-wait";
      item.notBefore = safeDate(input.notBefore, this.isoNow());
      item.attempt = Math.max(0, item.attempt - 1);
      if (input.code) item.failureCode = input.code;
      const message = safeText(input.message, 500);
      if (message) item.failureMessage = message;
      this.clearLease(item);
    });
  }

  fail(id: string, owner: string, code: CouncilFailureCode, message?: string): AutonomyWorkItem {
    return this.withLease(id, owner, item => {
      item.state = "failed";
      item.failureCode = code;
      const bounded = safeText(message, 500);
      if (bounded) item.failureMessage = bounded;
      item.completedAt = this.isoNow();
      this.clearLease(item);
    });
  }

  uncertain(id: string, owner: string | undefined, message?: string): AutonomyWorkItem {
    return this.mutateItem(id, item => {
      if (owner && item.leaseOwner && item.leaseOwner !== owner) throw new Error(`autonomy work ${id} is leased by another owner`);
      item.state = "uncertain";
      item.failureCode = "SUBMISSION_UNCERTAIN";
      const bounded = safeText(message, 500);
      if (bounded) item.failureMessage = bounded;
      item.completedAt = this.isoNow();
      this.clearLease(item);
    });
  }

  cancel(id: string, message = "cancelled"): AutonomyWorkItem {
    return this.mutateItem(id, item => {
      if (item.state === "running") throw new Error(`cannot cancel running autonomy work ${id}`);
      item.state = "cancelled";
      item.failureMessage = safeText(message, 500);
      item.completedAt = this.isoNow();
      this.clearLease(item);
    });
  }

  cancelWhere(predicate: (item: Readonly<AutonomyWorkItem>) => boolean, message = "cancelled by policy"): number {
    let changed = 0;
    for (const item of this.state.items) {
      if (TERMINAL.has(item.state) || item.state === "running" || !predicate(item)) continue;
      item.state = "cancelled";
      item.failureMessage = safeText(message, 500);
      item.completedAt = this.isoNow();
      this.clearLease(item);
      item.updatedAt = this.isoNow();
      changed += 1;
    }
    if (changed) this.persistMutation();
    return changed;
  }

  recoverExpiredLeases(): number {
    const nowMs = this.now();
    let changed = 0;
    for (const item of this.state.items) {
      if ((item.state !== "leased" && item.state !== "running") || !item.leaseExpiresAt || new Date(item.leaseExpiresAt).getTime() > nowMs) continue;
      if (councilPhaseReached(item.lastPhase, "submit-started")) {
        item.state = "uncertain";
        item.failureCode = "SUBMISSION_UNCERTAIN";
        item.failureMessage = "Process restarted after the ChatGPT submission boundary; automatic retry is disabled";
        item.completedAt = this.isoNow();
      } else {
        item.state = "queued";
        item.failureCode = "WORK_LEASE_EXPIRED";
        item.failureMessage = "Expired pre-submit work lease recovered after restart";
        item.notBefore = new Date(nowMs + 1_000).toISOString();
      }
      this.clearLease(item);
      item.updatedAt = this.isoNow();
      changed += 1;
    }
    if (changed) this.persistMutation();
    return changed;
  }

  private withLease(id: string, owner: string, change: (item: AutonomyWorkItem) => void): AutonomyWorkItem {
    const leaseOwner = safeId(owner, "leaseOwner", 160)!;
    return this.mutateItem(id, item => {
      if (item.leaseOwner !== leaseOwner) throw new Error(`autonomy work ${id} is not leased by ${leaseOwner}`);
      if (item.state !== "leased" && item.state !== "running") throw new Error(`autonomy work ${id} is not lease-active`);
      change(item);
    });
  }

  private mutateItem(id: string, change: (item: AutonomyWorkItem) => void): AutonomyWorkItem {
    const item = this.state.items.find(candidate => candidate.id === id);
    if (!item) throw new Error(`autonomy work does not exist: ${id}`);
    change(item);
    item.updatedAt = this.isoNow();
    this.persistMutation();
    return clone(item);
  }

  private clearLease(item: AutonomyWorkItem): void {
    delete item.leaseOwner;
    delete item.leaseExpiresAt;
  }

  private load(): WorkStateFile {
    if (!existsSync(this.filePath)) return { version: 1, revision: 0, items: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as WorkStateFile;
      if (parsed.version !== 1 || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0 || !Array.isArray(parsed.items)) throw new Error("invalid autonomy work state header");
      for (const item of parsed.items) {
        if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.kind !== "string" || typeof item.dedupeKey !== "string" || typeof item.state !== "string") throw new Error("invalid autonomy work item");
        item.correlationDepth = boundedInteger(item.correlationDepth, 0, 0, 64);
        item.attempt = boundedInteger(item.attempt, 0, 0, 20);
        item.maxAttempts = boundedInteger(item.maxAttempts, 4, 1, 20);
        item.reasons = Array.isArray(item.reasons) ? item.reasons.map(reason => safeText(String(reason), 300)).filter((reason): reason is string => Boolean(reason)).slice(-8) : [];
      }
      return parsed;
    } catch (error) {
      const corrupt = `${this.filePath}.corrupt-${Date.now()}`;
      try { renameSync(this.filePath, corrupt); } catch {}
      throw new Error(`Council autonomy work state is corrupt and was quarantined: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persistMutation(): void {
    this.state.revision += 1;
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { chmodSync(directory, 0o700); } catch {}
    const temp = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      renameSync(temp, this.filePath);
      try { chmodSync(this.filePath, 0o600); } catch {}
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
    for (const listener of this.listeners) {
      try { listener(this.state.revision); } catch {}
    }
  }

  private isoNow(): string { return new Date(this.now()).toISOString(); }
}
