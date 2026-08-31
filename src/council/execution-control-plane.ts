import { randomUUID } from "node:crypto";
import { councilPhaseReached, type CouncilExecutionPhase, type CouncilFailureCode } from "./autonomy-errors";
import type { CouncilChatGptState } from "./chatgpt-deep-state";
import type { CouncilObservationHealth } from "./observation-store";

export type CouncilExecutionRunKind = "turn" | "focus" | "capture";
export type CouncilExecutionRunStatus = "queued" | "active" | "waiting-user" | "completed" | "failed" | "aborted" | "uncertain";
export type CouncilExecutionRetrySafety = "safe-before-submit" | "forbidden-after-submit" | "operator-resolution-required";
export type CouncilExecutionEventKind =
  | "run-created"
  | "phase"
  | "deep-state"
  | "health"
  | "command-requested"
  | "command-accepted"
  | "command-rejected"
  | "failure"
  | "completed";
export type CouncilExecutionCommandType = "cancel" | "focus" | "capture" | "retry";

export interface CouncilExecutionRun {
  runId: string;
  traceId: string;
  agentId: string;
  kind: CouncilExecutionRunKind;
  status: CouncilExecutionRunStatus;
  phase?: CouncilExecutionPhase;
  deepState?: CouncilChatGptState;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  retrySafety: CouncilExecutionRetrySafety;
  failureCode?: CouncilFailureCode;
  failureMessage?: string;
  surfaceBound: boolean;
  conversationBound: boolean;
  eventCount: number;
}

export interface CouncilExecutionEvent {
  eventId: string;
  runId: string;
  kind: CouncilExecutionEventKind;
  at: string;
  phase?: CouncilExecutionPhase;
  deepState?: CouncilChatGptState;
  health?: CouncilObservationHealth;
  confidence?: number;
  failureCode?: CouncilFailureCode;
  message?: string;
}

export interface CouncilExecutionCommandReceipt {
  receiptId: string;
  commandType: CouncilExecutionCommandType;
  actorId: string;
  targetRunId?: string;
  targetAgentId?: string;
  requestedAt: string;
  outcome: "accepted" | "rejected";
  reason: string;
  resultingRunId?: string;
}

export interface CouncilExecutionRetryInput {
  phase?: CouncilExecutionPhase;
  status: CouncilExecutionRunStatus;
  failureCode?: CouncilFailureCode;
}

const SAFE_PRE_SUBMIT_FAILURES = new Set<CouncilFailureCode>([
  "CAPACITY_BUSY",
  "SURFACE_UNAVAILABLE",
  "CONNECTION_FAILED",
]);
const TERMINAL_RUN_STATUSES = new Set<CouncilExecutionRunStatus>(["completed", "failed", "aborted", "uncertain"]);
const ACTIVE_DEEP_STATES = new Set<CouncilChatGptState>([
  "QUEUED",
  "THINKING",
  "DEEP_THINKING",
  "STREAMING",
  "TOOL_RUNNING",
  "COMPLETING",
]);

export function isTerminalExecutionStatus(status: CouncilExecutionRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function deriveExecutionRetrySafety(input: CouncilExecutionRetryInput): CouncilExecutionRetrySafety {
  if (input.status === "uncertain" || input.failureCode === "SUBMISSION_UNCERTAIN") return "operator-resolution-required";
  if (input.phase && councilPhaseReached(input.phase, "submit-started")) return "forbidden-after-submit";
  if (input.status === "completed" || input.status === "waiting-user") return "forbidden-after-submit";
  if (input.failureCode) return SAFE_PRE_SUBMIT_FAILURES.has(input.failureCode) ? "safe-before-submit" : "forbidden-after-submit";
  if (input.status === "failed") return "forbidden-after-submit";
  return "safe-before-submit";
}

export interface CouncilExecutionControlPlaneOptions {
  now?: () => number;
  id?: (prefix: string) => string;
  maxRuns?: number;
  maxEventsPerRun?: number;
  maxReceipts?: number;
}

function boundedText(value: string, max = 500): string {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function iso(now: number): string { return new Date(now).toISOString(); }
function cloneRun(run: CouncilExecutionRun): CouncilExecutionRun { return structuredClone(run); }
function cloneEvent(event: CouncilExecutionEvent): CouncilExecutionEvent { return structuredClone(event); }
function cloneFrozenReceipt(receipt: CouncilExecutionCommandReceipt): Readonly<CouncilExecutionCommandReceipt> {
  return Object.freeze(structuredClone(receipt));
}

export class CouncilExecutionControlPlane {
  private readonly now: () => number;
  private readonly id: (prefix: string) => string;
  private readonly maxRuns: number;
  private readonly maxEventsPerRun: number;
  private readonly maxReceipts: number;
  private readonly runs = new Map<string, CouncilExecutionRun>();
  private readonly eventHistory = new Map<string, CouncilExecutionEvent[]>();
  private readonly commandReceipts: Readonly<CouncilExecutionCommandReceipt>[] = [];
  private readonly cancellationHandles = new Map<string, AbortController>();

  constructor(options: CouncilExecutionControlPlaneOptions = {}) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? (prefix => `${prefix}_${randomUUID().replaceAll("-", "")}`);
    this.maxRuns = Math.max(1, Math.min(4_096, Math.trunc(options.maxRuns ?? 256)));
    this.maxEventsPerRun = Math.max(2, Math.min(4_096, Math.trunc(options.maxEventsPerRun ?? 128)));
    this.maxReceipts = Math.max(1, Math.min(8_192, Math.trunc(options.maxReceipts ?? 1_024)));
  }

  createRun(input: { traceId: string; agentId: string; kind: CouncilExecutionRunKind; conversationBound?: boolean }): CouncilExecutionRun {
    this.makeCapacityForRun();
    const now = this.now();
    const run: CouncilExecutionRun = {
      runId: this.id("run"),
      traceId: input.traceId,
      agentId: input.agentId,
      kind: input.kind,
      status: "active",
      startedAt: iso(now),
      updatedAt: iso(now),
      retrySafety: "safe-before-submit",
      surfaceBound: false,
      conversationBound: input.conversationBound === true,
      eventCount: 0,
    };
    this.runs.set(run.runId, run);
    this.eventHistory.set(run.runId, []);
    this.appendEvent(run.runId, { kind: "run-created" });
    return cloneRun(this.requireRun(run.runId));
  }

  listRuns(): CouncilExecutionRun[] {
    return [...this.runs.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.startedAt.localeCompare(left.startedAt))
      .map(cloneRun);
  }

  readRun(runId: string): CouncilExecutionRun | undefined {
    const run = this.runs.get(runId);
    return run ? cloneRun(run) : undefined;
  }

  events(runId: string): CouncilExecutionEvent[] {
    return (this.eventHistory.get(runId) ?? []).map(cloneEvent);
  }

  receipts(limit = this.maxReceipts): Readonly<CouncilExecutionCommandReceipt>[] {
    const safeLimit = Math.max(1, Math.min(this.maxReceipts, Math.trunc(limit)));
    return this.commandReceipts.slice(-safeLimit).map(cloneFrozenReceipt);
  }

  registerCancellation(runId: string, controller: AbortController): void {
    this.requireMutable(runId);
    if (controller.signal.aborted) throw new Error(`Council execution cancellation handle is already aborted: ${runId}`);
    if (this.cancellationHandles.has(runId)) throw new Error(`Council execution cancellation handle already exists: ${runId}`);
    this.cancellationHandles.set(runId, controller);
  }

  releaseCancellation(runId: string, controller?: AbortController): void {
    const current = this.cancellationHandles.get(runId);
    if (!current) return;
    if (controller && current !== controller) return;
    this.cancellationHandles.delete(runId);
  }

  cancelRun(runId: string, message = "Local execution cancellation requested"): CouncilExecutionRun {
    this.requireMutable(runId);
    const controller = this.cancellationHandles.get(runId);
    if (!controller) throw new Error(`Council execution run is not locally cancellable: ${runId}`);
    this.cancellationHandles.delete(runId);
    const result = this.abortRun(runId, message);
    controller.abort();
    return result;
  }

  markSurfaceBound(runId: string, value = true): CouncilExecutionRun {
    const run = this.requireRun(runId);
    run.surfaceBound = value;
    this.touch(run);
    return cloneRun(run);
  }

  markConversationBound(runId: string, value = true): CouncilExecutionRun {
    const run = this.requireRun(runId);
    run.conversationBound = value;
    this.touch(run);
    return cloneRun(run);
  }

  recordPhase(runId: string, phase: CouncilExecutionPhase): CouncilExecutionRun {
    const run = this.requireMutable(runId);
    if (run.phase === phase) return cloneRun(run);
    run.phase = phase;
    if (run.status === "waiting-user") run.status = "active";
    run.retrySafety = deriveExecutionRetrySafety(run);
    this.touch(run);
    this.appendEvent(runId, { kind: "phase", phase });
    return cloneRun(run);
  }

  recordDeepState(runId: string, input: { state: CouncilChatGptState; confidence: number; reason: string }): CouncilExecutionRun {
    const run = this.requireMutable(runId);
    if (run.deepState === input.state) return cloneRun(run);
    run.deepState = input.state;
    if (input.state === "WAITING_USER") run.status = "waiting-user";
    else if (ACTIVE_DEEP_STATES.has(input.state) && run.status === "waiting-user") run.status = "active";
    run.retrySafety = deriveExecutionRetrySafety(run);
    this.touch(run);
    this.appendEvent(runId, {
      kind: "deep-state",
      deepState: input.state,
      confidence: Math.max(0, Math.min(1, input.confidence)),
      message: boundedText(input.reason),
    });
    return cloneRun(run);
  }

  recordHealth(runId: string, input: { health: CouncilObservationHealth; note?: string }): CouncilExecutionRun {
    const run = this.requireMutable(runId);
    this.touch(run);
    this.appendEvent(runId, { kind: "health", health: input.health, ...(input.note ? { message: boundedText(input.note) } : {}) });
    return cloneRun(run);
  }

  completeRun(runId: string): CouncilExecutionRun {
    const run = this.requireMutable(runId);
    const now = this.now();
    run.status = "completed";
    run.completedAt = iso(now);
    run.updatedAt = iso(now);
    run.retrySafety = deriveExecutionRetrySafety(run);
    this.cancellationHandles.delete(runId);
    this.appendEvent(runId, { kind: "completed" });
    this.pruneTerminalRuns();
    return cloneRun(this.requireRun(runId));
  }

  abortRun(runId: string, message = "Local execution was aborted"): CouncilExecutionRun {
    const run = this.requireMutable(runId);
    const now = this.now();
    run.status = councilPhaseReached(run.phase, "submit-started") ? "uncertain" : "aborted";
    run.failureCode = run.status === "uncertain" ? "SUBMISSION_UNCERTAIN" : undefined;
    run.failureMessage = boundedText(message);
    run.completedAt = iso(now);
    run.updatedAt = iso(now);
    run.retrySafety = deriveExecutionRetrySafety(run);
    this.cancellationHandles.delete(runId);
    this.appendEvent(runId, {
      kind: "failure",
      ...(run.failureCode ? { failureCode: run.failureCode } : {}),
      message: run.failureMessage,
    });
    this.pruneTerminalRuns();
    return cloneRun(this.requireRun(runId));
  }

  failRun(runId: string, input: { failureCode: CouncilFailureCode; message: string; uncertain?: boolean }): CouncilExecutionRun {
    const run = this.requireMutable(runId);
    const now = this.now();
    run.status = input.uncertain === true || input.failureCode === "SUBMISSION_UNCERTAIN" ? "uncertain" : "failed";
    run.failureCode = run.status === "uncertain" ? "SUBMISSION_UNCERTAIN" : input.failureCode;
    run.failureMessage = boundedText(input.message);
    run.completedAt = iso(now);
    run.updatedAt = iso(now);
    run.retrySafety = deriveExecutionRetrySafety(run);
    this.cancellationHandles.delete(runId);
    this.appendEvent(runId, { kind: "failure", failureCode: run.failureCode, message: run.failureMessage });
    this.pruneTerminalRuns();
    return cloneRun(this.requireRun(runId));
  }

  recordCommandReceipt(input: Omit<CouncilExecutionCommandReceipt, "receiptId" | "requestedAt">): Readonly<CouncilExecutionCommandReceipt> {
    const receipt: Readonly<CouncilExecutionCommandReceipt> = Object.freeze({
      receiptId: this.id("receipt"),
      commandType: input.commandType,
      actorId: input.actorId,
      ...(input.targetRunId ? { targetRunId: input.targetRunId } : {}),
      ...(input.targetAgentId ? { targetAgentId: input.targetAgentId } : {}),
      requestedAt: iso(this.now()),
      outcome: input.outcome,
      reason: boundedText(input.reason),
      ...(input.resultingRunId ? { resultingRunId: input.resultingRunId } : {}),
    });
    this.commandReceipts.push(receipt);
    if (this.commandReceipts.length > this.maxReceipts) this.commandReceipts.splice(0, this.commandReceipts.length - this.maxReceipts);
    if (input.targetRunId && this.runs.has(input.targetRunId)) {
      this.appendEvent(input.targetRunId, {
        kind: input.outcome === "accepted" ? "command-accepted" : "command-rejected",
        message: `${input.commandType}: ${boundedText(input.reason, 420)}`,
      });
    }
    return cloneFrozenReceipt(receipt);
  }

  private touch(run: CouncilExecutionRun): void {
    run.updatedAt = iso(this.now());
  }

  private appendEvent(runId: string, partial: Omit<CouncilExecutionEvent, "eventId" | "runId" | "at">): void {
    const run = this.requireRun(runId);
    const history = this.eventHistory.get(runId) ?? [];
    history.push({ eventId: this.id("event"), runId, at: iso(this.now()), ...partial });
    if (history.length > this.maxEventsPerRun) {
      const first = history[0];
      const keepCreation = first?.kind === "run-created" ? first : undefined;
      const tailCount = this.maxEventsPerRun - (keepCreation ? 1 : 0);
      const tail = history.slice(-tailCount);
      history.splice(0, history.length, ...(keepCreation ? [keepCreation, ...tail.filter(event => event.eventId !== keepCreation.eventId)] : tail));
    }
    this.eventHistory.set(runId, history);
    run.eventCount = history.length;
    run.updatedAt = iso(this.now());
  }

  private requireRun(runId: string): CouncilExecutionRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Council execution run does not exist: ${runId}`);
    return run;
  }

  private requireMutable(runId: string): CouncilExecutionRun {
    const run = this.requireRun(runId);
    if (TERMINAL_RUN_STATUSES.has(run.status)) throw new Error(`Council execution run is terminal: ${runId}`);
    return run;
  }

  private makeCapacityForRun(): void {
    while (this.runs.size >= this.maxRuns) {
      const candidate = this.oldestTerminalRun();
      if (!candidate) throw new Error("Council execution run capacity is full with active work");
      this.deleteRun(candidate.runId);
    }
  }

  private pruneTerminalRuns(): void {
    while (this.runs.size > this.maxRuns) {
      const candidate = this.oldestTerminalRun();
      if (!candidate) break;
      this.deleteRun(candidate.runId);
    }
  }

  private oldestTerminalRun(): CouncilExecutionRun | undefined {
    return [...this.runs.values()]
      .filter(run => TERMINAL_RUN_STATUSES.has(run.status))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.updatedAt.localeCompare(right.updatedAt))[0];
  }

  private deleteRun(runId: string): void {
    this.cancellationHandles.delete(runId);
    this.runs.delete(runId);
    this.eventHistory.delete(runId);
  }
}
