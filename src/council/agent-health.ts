import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CouncilFailureCode } from "./autonomy-errors";

export type CouncilAgentHealthState =
  | "healthy"
  | "sleeping"
  | "busy"
  | "stalled"
  | "limited"
  | "signed-out"
  | "disconnected"
  | "conversation-missing"
  | "surface-missing"
  | "quarantined"
  | "unknown";

export type CouncilAgentHealthSource = "browser" | "supervisor" | "dispatcher" | "presence" | "operator";

export interface CouncilAgentHealthEvidence {
  at: string;
  source: CouncilAgentHealthSource;
  state: CouncilAgentHealthState;
  code?: CouncilFailureCode;
  note?: string;
}

export interface CouncilAgentHealthRecord {
  agentId: string;
  state: CouncilAgentHealthState;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  consecutiveFailures: number;
  lastFailureCode?: CouncilFailureCode;
  cooldownUntil?: string;
  lastObservedAt?: string;
  evidence: CouncilAgentHealthEvidence[];
}

interface HealthStateFile { version: 1; agents: Record<string, CouncilAgentHealthRecord> }

const LIMITED_COOLDOWN_MS = 60 * 60 * 1_000;
const CONNECTION_BASE_MS = 30_000;
const CONNECTION_CAP_MS = 15 * 60 * 1_000;
const STALL_BASE_MS = 2 * 60 * 1_000;
const STALL_CAP_MS = 10 * 60 * 1_000;
const TRANSIENT_BUSY_MS = 15_000;
const MAX_EVIDENCE = 20;

function clone<T>(value: T): T { return structuredClone(value); }
function safeNote(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const compact = value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 500);
  return compact || undefined;
}
function validAgentId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error("agentId is invalid");
  return id;
}

export class CouncilAgentHealthLedger {
  private state: HealthStateFile;
  private readonly path: string;
  private readonly now: () => number;

  constructor(path: string, options: { now?: () => number } = {}) {
    this.path = path;
    this.now = options.now ?? Date.now;
    this.state = this.load();
  }

  get(agentId: string): CouncilAgentHealthRecord | undefined {
    const record = this.state.agents[validAgentId(agentId)];
    return record ? clone(record) : undefined;
  }

  snapshot(): CouncilAgentHealthRecord[] {
    return Object.values(this.state.agents).sort((a, b) => a.agentId.localeCompare(b.agentId)).map(clone);
  }

  observeSuccess(agentId: string, source: CouncilAgentHealthSource): CouncilAgentHealthRecord {
    const record = this.ensure(agentId);
    const now = this.isoNow();
    record.state = "healthy";
    record.lastSuccessAt = now;
    record.lastAttemptAt = now;
    record.lastObservedAt = now;
    record.consecutiveFailures = 0;
    delete record.lastFailureCode;
    delete record.cooldownUntil;
    this.pushEvidence(record, { at: now, source, state: "healthy" });
    this.write();
    return clone(record);
  }

  observeSleeping(agentId: string, source: CouncilAgentHealthSource): CouncilAgentHealthRecord {
    const record = this.ensure(agentId);
    const now = this.isoNow();
    if (record.state !== "limited" && record.state !== "signed-out" && record.state !== "quarantined") record.state = "sleeping";
    record.lastObservedAt = now;
    this.pushEvidence(record, { at: now, source, state: record.state, note: "Agent is parked between managed turns" });
    this.write();
    return clone(record);
  }

  observeSupervisor(agentId: string, state: CouncilAgentHealthState, note?: string): CouncilAgentHealthRecord {
    const record = this.ensure(agentId);
    const now = this.isoNow();
    if (record.state !== "quarantined" || state === "healthy") record.state = state;
    record.lastObservedAt = now;
    if (state === "healthy") {
      record.lastSuccessAt = now;
      record.consecutiveFailures = 0;
      delete record.lastFailureCode;
      delete record.cooldownUntil;
    }
    this.pushEvidence(record, { at: now, source: "supervisor", state: record.state, ...(safeNote(note) ? { note: safeNote(note)! } : {}) });
    this.write();
    return clone(record);
  }

  observeFailure(agentId: string, code: CouncilFailureCode, note: string | undefined, source: CouncilAgentHealthSource): CouncilAgentHealthRecord {
    const record = this.ensure(agentId);
    const nowMs = this.now();
    const now = new Date(nowMs).toISOString();
    record.lastAttemptAt = now;
    record.lastObservedAt = now;
    record.consecutiveFailures += 1;
    record.lastFailureCode = code;
    delete record.cooldownUntil;

    switch (code) {
      case "CHATGPT_LIMITED":
        record.state = "limited";
        record.cooldownUntil = new Date(nowMs + LIMITED_COOLDOWN_MS).toISOString();
        break;
      case "CHATGPT_SIGNED_OUT":
        record.state = "signed-out";
        break;
      case "CONNECTION_FAILED": {
        record.state = "disconnected";
        const cooldown = Math.min(CONNECTION_CAP_MS, CONNECTION_BASE_MS * (2 ** Math.max(0, record.consecutiveFailures - 1)));
        record.cooldownUntil = new Date(nowMs + cooldown).toISOString();
        break;
      }
      case "RESPONSE_STALLED": {
        record.state = "stalled";
        const cooldown = Math.min(STALL_CAP_MS, STALL_BASE_MS * Math.max(1, record.consecutiveFailures));
        record.cooldownUntil = new Date(nowMs + cooldown).toISOString();
        break;
      }
      case "CONVERSATION_UNAVAILABLE":
        record.state = "conversation-missing";
        break;
      case "SURFACE_UNAVAILABLE":
        record.state = "surface-missing";
        record.cooldownUntil = new Date(nowMs + TRANSIENT_BUSY_MS).toISOString();
        break;
      case "CAPACITY_BUSY":
        record.state = "busy";
        record.cooldownUntil = new Date(nowMs + TRANSIENT_BUSY_MS).toISOString();
        break;
      case "SUBMISSION_UNCERTAIN":
        record.state = "quarantined";
        break;
      default:
        record.state = "unknown";
        break;
    }

    this.pushEvidence(record, { at: now, source, state: record.state, code, ...(safeNote(note) ? { note: safeNote(note)! } : {}) });
    this.write();
    return clone(record);
  }

  canAttempt(agentId: string): { allowed: boolean; reasonCode?: CouncilFailureCode; retryAt?: string } {
    const record = this.state.agents[validAgentId(agentId)];
    if (!record) return { allowed: true };
    if (record.state === "signed-out") return { allowed: false, reasonCode: "CHATGPT_SIGNED_OUT" };
    if (record.state === "quarantined") return { allowed: false, reasonCode: "SUBMISSION_UNCERTAIN" };
    if (record.cooldownUntil && new Date(record.cooldownUntil).getTime() > this.now()) {
      return { allowed: false, reasonCode: record.lastFailureCode, retryAt: record.cooldownUntil };
    }
    return { allowed: true };
  }

  private ensure(agentId: string): CouncilAgentHealthRecord {
    const id = validAgentId(agentId);
    return this.state.agents[id] ??= { agentId: id, state: "unknown", consecutiveFailures: 0, evidence: [] };
  }

  private pushEvidence(record: CouncilAgentHealthRecord, evidence: CouncilAgentHealthEvidence): void {
    record.evidence = [...record.evidence, { ...evidence, ...(safeNote(evidence.note) ? { note: safeNote(evidence.note)! } : {}) }].slice(-MAX_EVIDENCE);
  }

  private load(): HealthStateFile {
    if (!existsSync(this.path)) return { version: 1, agents: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as HealthStateFile;
      if (parsed.version !== 1 || !parsed.agents || typeof parsed.agents !== "object" || Array.isArray(parsed.agents)) throw new Error("invalid health state");
      return parsed;
    } catch (error) {
      try { renameSync(this.path, `${this.path}.corrupt-${Date.now()}`); } catch {}
      throw new Error(`Council agent health state is corrupt and was quarantined: ${error instanceof Error ? error.message : String(error)}`);
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

  private isoNow(): string { return new Date(this.now()).toISOString(); }
}
