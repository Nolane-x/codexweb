import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CouncilFailureCode } from "./autonomy-errors";
import type { AutonomyWorkKind } from "./autonomy-work-store";

export type CouncilAutonomyAuditTransition =
  | "created"
  | "coalesced"
  | "leased"
  | "running"
  | "phase"
  | "retry"
  | "uncertain"
  | "completed"
  | "failed"
  | "policy-blocked"
  | "cancelled"
  | "recovered-after-restart";

export interface CouncilAutonomyAuditEvent {
  sequence: number;
  timestamp: string;
  correlationId: string;
  workItemId: string;
  kind: AutonomyWorkKind;
  transition: CouncilAutonomyAuditTransition;
  sourceAgentId?: string;
  targetAgentId?: string;
  taskId?: string;
  wakeId?: string;
  code?: CouncilFailureCode;
  reason?: string;
}

export interface CouncilAutonomyAuditInput extends Omit<CouncilAutonomyAuditEvent, "sequence" | "timestamp"> {}
interface AuditStateFile { version: 1; nextSequence: number; events: CouncilAutonomyAuditEvent[] }

const DEFAULT_MAX_EVENTS = 10_000;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

function bounded(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const safe = value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
  return safe || undefined;
}
function clone<T>(value: T): T { return structuredClone(value); }

export class CouncilAutonomyAuditStore {
  private state: AuditStateFile;
  private readonly path: string;
  private readonly now: () => number;
  private readonly maxEvents: number;
  private readonly maxAgeMs: number;

  constructor(path: string, options: { now?: () => number; maxEvents?: number; maxAgeMs?: number } = {}) {
    this.path = path;
    this.now = options.now ?? Date.now;
    this.maxEvents = Math.max(10, Math.min(100_000, Math.trunc(options.maxEvents ?? DEFAULT_MAX_EVENTS)));
    this.maxAgeMs = Math.max(1_000, Math.min(365 * 24 * 60 * 60 * 1_000, Math.trunc(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS)));
    this.state = this.load();
    this.prune(false);
  }

  append(input: CouncilAutonomyAuditInput): CouncilAutonomyAuditEvent {
    const event: CouncilAutonomyAuditEvent = {
      sequence: this.state.nextSequence++,
      timestamp: new Date(this.now()).toISOString(),
      correlationId: bounded(input.correlationId, 160) ?? "unknown",
      workItemId: bounded(input.workItemId, 160) ?? "unknown",
      kind: input.kind,
      transition: input.transition,
      ...(bounded(input.sourceAgentId, 128) ? { sourceAgentId: bounded(input.sourceAgentId, 128)! } : {}),
      ...(bounded(input.targetAgentId, 128) ? { targetAgentId: bounded(input.targetAgentId, 128)! } : {}),
      ...(bounded(input.taskId, 128) ? { taskId: bounded(input.taskId, 128)! } : {}),
      ...(bounded(input.wakeId, 128) ? { wakeId: bounded(input.wakeId, 128)! } : {}),
      ...(input.code ? { code: input.code } : {}),
      ...(bounded(input.reason, 500) ? { reason: bounded(input.reason, 500)! } : {}),
    };
    this.state.events.push(event);
    this.prune(false);
    this.write();
    return clone(event);
  }

  list(limit = 100): CouncilAutonomyAuditEvent[] {
    const count = Math.max(1, Math.min(200, Math.trunc(limit)));
    this.prune(false);
    return clone(this.state.events.slice(-count));
  }

  summary(): { count: number; latestSequence: number; byTransition: Record<string, number> } {
    this.prune(false);
    const byTransition: Record<string, number> = {};
    for (const event of this.state.events) byTransition[event.transition] = (byTransition[event.transition] ?? 0) + 1;
    return {
      count: this.state.events.length,
      latestSequence: this.state.events.at(-1)?.sequence ?? 0,
      byTransition,
    };
  }

  private prune(writeIfChanged: boolean): void {
    const cutoff = this.now() - this.maxAgeMs;
    const before = this.state.events.length;
    this.state.events = this.state.events.filter(event => new Date(event.timestamp).getTime() >= cutoff);
    if (this.state.events.length > this.maxEvents) this.state.events = this.state.events.slice(-this.maxEvents);
    if (writeIfChanged && this.state.events.length !== before) this.write();
  }

  private load(): AuditStateFile {
    if (!existsSync(this.path)) return { version: 1, nextSequence: 1, events: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as AuditStateFile;
      if (parsed.version !== 1 || !Number.isSafeInteger(parsed.nextSequence) || parsed.nextSequence < 1 || !Array.isArray(parsed.events)) throw new Error("invalid audit header");
      return parsed;
    } catch (error) {
      try { renameSync(this.path, `${this.path}.corrupt-${Date.now()}`); } catch {}
      throw new Error(`Council autonomy audit is corrupt and was quarantined: ${error instanceof Error ? error.message : String(error)}`);
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
