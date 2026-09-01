import { randomUUID } from "node:crypto";
import {
  boundedFailureMessage,
  classifyCouncilFailure,
  councilPhaseReached,
  type CouncilExecutionPhase,
} from "./autonomy-errors";
import type { CouncilChatGptState } from "./chatgpt-deep-state";
import {
  isTerminalExecutionStatus,
  type CouncilExecutionControlPlane,
  type CouncilExecutionRunKind,
} from "./execution-control-plane";
import type { CouncilObservationHealth } from "./observation-store";

export class CouncilConversationUnavailableError extends Error {
  constructor(message = "Council conversation is unavailable") { super(message); this.name = "CouncilConversationUnavailableError"; }
}

export class CouncilSurfaceUnavailableError extends Error {
  constructor(message = "Council browser surface is unavailable before submit") { super(message); this.name = "CouncilSurfaceUnavailableError"; }
}

export interface CouncilPersistentTurnControl {
  start(input: { traceId: string; bindingKey: string }): Promise<{ surfaceId: string }>;
  heartbeat(input: { traceId: string }): Promise<void>;
  end(input: { traceId: string; status: "completed" | "failed" | "aborted"; message?: string }): Promise<void>;
  release?(input: { bindingKey: string }): Promise<boolean>;
}

export interface CouncilPromptAttachment {
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  buffer: Buffer;
}

export type CouncilExecutionObservation =
  | { type: "phase"; phase: CouncilExecutionPhase }
  | { type: "deep-state"; state: CouncilChatGptState; confidence: number; reason: string }
  | { type: "health"; health: CouncilObservationHealth; note?: string };
/** Generic default deliberately stays permissive for legacy imports during the 4.1 migration.
 * New public telemetry boundaries use the explicit aliases below and remain strongly typed. */
export type CouncilExecutionObserver<T = any> = (value: T) => void;
export type CouncilExecutionPhaseObserver = CouncilExecutionObserver<CouncilExecutionPhase>;
export type CouncilExecutionTelemetryObserver = CouncilExecutionObserver<CouncilExecutionObservation>;

export interface CouncilPersistentChatDriver {
  resume(input: { surfaceId: string; conversationUrl: string; prompt: string; attachments?: CouncilPromptAttachment[]; signal?: AbortSignal; onPhase?: CouncilExecutionPhaseObserver; onExecution?: CouncilExecutionTelemetryObserver }): Promise<{ answer: string; conversationUrl: string }>;
  create(input: { surfaceId: string; prompt: string; attachments?: CouncilPromptAttachment[]; signal?: AbortSignal; onPhase?: CouncilExecutionPhaseObserver; onExecution?: CouncilExecutionTelemetryObserver }): Promise<{ answer: string; conversationUrl: string }>;
  focus?(input: { surfaceId: string; conversationUrl: string; signal?: AbortSignal }): Promise<{ conversationUrl: string }>;
  capture?(input: { surfaceId: string; conversationUrl: string; signal?: AbortSignal }): Promise<{ png: Buffer; conversationUrl: string; health: CouncilObservationHealth; note?: string }>;
}

export interface CouncilBrowserTransportRunInput {
  agentId: string;
  conversationUrl?: string;
  prompt: string;
  resurrectionPrompt?: string;
  attachments?: CouncilPromptAttachment[];
  signal?: AbortSignal;
  onPhase?: CouncilExecutionPhaseObserver;
  onExecution?: CouncilExecutionTelemetryObserver;
}
export interface CouncilBrowserTransportResult { answer: string; conversationUrl: string; resumed: boolean }
export interface CouncilBrowserCaptureResult { png: Buffer; conversationUrl: string; health: CouncilObservationHealth; note?: string }

export interface CouncilBrowserTransportOptions {
  heartbeatMs?: number;
  execution?: CouncilExecutionControlPlane;
}

interface ExecutionContext {
  runId?: string;
  controller?: AbortController;
  signal?: AbortSignal;
  dispose(): void;
}

function validAgentId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error("agentId is invalid");
  return id;
}

function emitPhase(legacy: CouncilExecutionPhaseObserver | undefined, observer: CouncilExecutionTelemetryObserver | undefined, phase: CouncilExecutionPhase): void {
  legacy?.(phase);
  observer?.({ type: "phase", phase });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function mergeAbortSignals(signals: Array<AbortSignal | undefined>): { signal?: AbortSignal; dispose(): void } {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return { signal: undefined, dispose: () => {} };
  if (active.length === 1) return { signal: active[0], dispose: () => {} };
  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    const listener = abort;
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const { signal, listener } of listeners) signal.removeEventListener("abort", listener);
    },
  };
}

export class CouncilBrowserTransport {
  private readonly control: CouncilPersistentTurnControl;
  private readonly driver: CouncilPersistentChatDriver;
  private readonly options: CouncilBrowserTransportOptions;

  constructor(control: CouncilPersistentTurnControl, driver: CouncilPersistentChatDriver, options: CouncilBrowserTransportOptions = {}) {
    this.control = control;
    this.driver = driver;
    this.options = options;
  }

  private heartbeat(traceId: string): { stop: () => void } {
    const heartbeatMs = this.options.heartbeatMs ?? 10_000;
    if (heartbeatMs <= 0) return { stop: () => {} };
    const timer = setInterval(() => { void this.control.heartbeat({ traceId }).catch(() => {}); }, heartbeatMs);
    timer.unref?.();
    return { stop: () => clearInterval(timer) };
  }

  private beginExecution(input: { agentId: string; kind: CouncilExecutionRunKind; conversationBound?: boolean; externalSignal?: AbortSignal }): ExecutionContext {
    const execution = this.options.execution;
    if (!execution) return { signal: input.externalSignal, dispose: () => {} };
    const controller = new AbortController();
    const run = execution.createRun({
      traceId: `execution_${randomUUID().replaceAll("-", "")}`,
      agentId: input.agentId,
      kind: input.kind,
      conversationBound: input.conversationBound,
    });
    execution.registerCancellation(run.runId, controller);
    const merged = mergeAbortSignals([input.externalSignal, controller.signal]);
    return {
      runId: run.runId,
      controller,
      signal: merged.signal,
      dispose: () => {
        merged.dispose();
        execution.releaseCancellation(run.runId, controller);
      },
    };
  }

  private executionObserver(runId: string | undefined, downstream?: CouncilExecutionTelemetryObserver): CouncilExecutionTelemetryObserver | undefined {
    const execution = this.options.execution;
    if (!execution || !runId) return downstream;
    return observation => {
      const current = execution.readRun(runId);
      if (current && !isTerminalExecutionStatus(current.status)) {
        if (observation.type === "phase") execution.recordPhase(runId, observation.phase);
        else if (observation.type === "deep-state") execution.recordDeepState(runId, observation);
        else execution.recordHealth(runId, observation);
      }
      downstream?.(observation);
    };
  }

  private markSurfaceBound(runId?: string): void {
    if (!runId) return;
    this.options.execution?.markSurfaceBound(runId, true);
  }

  private completeExecution(runId: string | undefined, conversationBound = false): void {
    if (!runId || !this.options.execution) return;
    const current = this.options.execution.readRun(runId);
    if (!current || isTerminalExecutionStatus(current.status)) return;
    if (conversationBound) this.options.execution.markConversationBound(runId, true);
    this.options.execution.completeRun(runId);
  }

  private failExecution(runId: string | undefined, error: unknown): void {
    const execution = this.options.execution;
    if (!runId || !execution) return;
    const current = execution.readRun(runId);
    if (!current || isTerminalExecutionStatus(current.status) || current.status === "waiting-user") return;
    if (isAbortError(error)) {
      execution.abortRun(runId, boundedFailureMessage(error));
      return;
    }
    const classification = classifyCouncilFailure(error);
    const uncertain = councilPhaseReached(current.phase, "submit-started");
    execution.failRun(runId, {
      failureCode: uncertain ? "SUBMISSION_UNCERTAIN" : classification.code,
      message: boundedFailureMessage(error),
      uncertain,
    });
  }

  private canRetrySurface(runId: string | undefined, error: unknown, signal?: AbortSignal): boolean {
    if (!(error instanceof CouncilSurfaceUnavailableError) || !this.control.release || signal?.aborted) return false;
    if (!runId || !this.options.execution) return true;
    const run = this.options.execution.readRun(runId);
    return Boolean(run && !isTerminalExecutionStatus(run.status) && !councilPhaseReached(run.phase, "submit-started"));
  }

  private async runAttempt(input: CouncilBrowserTransportRunInput, bindingKey: string, executionRunId?: string): Promise<CouncilBrowserTransportResult> {
    const traceId = `council_${randomUUID().replaceAll("-", "")}`;
    const lease = await this.control.start({ traceId, bindingKey });
    this.markSurfaceBound(executionRunId);
    emitPhase(input.onPhase, input.onExecution, "lease-acquired");
    const heartbeat = this.heartbeat(traceId);
    try {
      let result: { answer: string; conversationUrl: string };
      let resumed = false;
      if (input.conversationUrl) {
        try {
          result = await this.driver.resume({
            surfaceId: lease.surfaceId,
            conversationUrl: input.conversationUrl,
            prompt: input.prompt,
            ...(input.attachments?.length ? { attachments: input.attachments } : {}),
            signal: input.signal,
            onPhase: input.onPhase,
            onExecution: input.onExecution,
          });
          resumed = true;
        } catch (error) {
          if (!(error instanceof CouncilConversationUnavailableError)) throw error;
          const resurrection = input.resurrectionPrompt?.trim();
          if (!resurrection) throw error;
          result = await this.driver.create({
            surfaceId: lease.surfaceId,
            prompt: resurrection,
            ...(input.attachments?.length ? { attachments: input.attachments } : {}),
            signal: input.signal,
            onPhase: input.onPhase,
            onExecution: input.onExecution,
          });
        }
      } else {
        result = await this.driver.create({
          surfaceId: lease.surfaceId,
          prompt: input.resurrectionPrompt?.trim() || input.prompt,
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
          signal: input.signal,
          onPhase: input.onPhase,
          onExecution: input.onExecution,
        });
      }
      await this.control.end({ traceId, status: "completed" });
      return { ...result, resumed };
    } catch (error) {
      const aborted = isAbortError(error) || error instanceof CouncilSurfaceUnavailableError;
      await this.control.end({ traceId, status: aborted ? "aborted" : "failed", message: boundedFailureMessage(error) }).catch(() => {});
      throw error;
    } finally {
      heartbeat.stop();
    }
  }

  async run(input: CouncilBrowserTransportRunInput): Promise<CouncilBrowserTransportResult> {
    const agentId = validAgentId(input.agentId);
    if (!input.prompt.trim()) throw new Error("prompt is required");
    if (input.signal?.aborted) throw new DOMException("Council browser turn aborted", "AbortError");
    const execution = this.beginExecution({ agentId, kind: "turn", conversationBound: Boolean(input.conversationUrl), externalSignal: input.signal });
    const onExecution = this.executionObserver(execution.runId, input.onExecution);
    const attemptInput: CouncilBrowserTransportRunInput = { ...input, signal: execution.signal, ...(onExecution ? { onExecution } : {}) };
    const bindingKey = `agent:${agentId}`;
    try {
      let result: CouncilBrowserTransportResult;
      try {
        result = await this.runAttempt(attemptInput, bindingKey, execution.runId);
      } catch (error) {
        if (!this.canRetrySurface(execution.runId, error, execution.signal)) throw error;
        await this.control.release!({ bindingKey });
        if (execution.signal?.aborted) throw new DOMException("Council browser turn aborted", "AbortError");
        result = await this.runAttempt(attemptInput, bindingKey, execution.runId);
      }
      this.completeExecution(execution.runId, true);
      return result;
    } catch (error) {
      this.failExecution(execution.runId, error);
      throw error;
    } finally {
      execution.dispose();
    }
  }

  async focusConversation(input: { agentId: string; conversationUrl: string; signal?: AbortSignal }): Promise<{ conversationUrl: string }> {
    const agentId = validAgentId(input.agentId);
    if (!this.driver.focus) throw new Error("Council browser driver does not support persistent conversation focus");
    if (input.signal?.aborted) throw new DOMException("Council browser focus aborted", "AbortError");
    const execution = this.beginExecution({ agentId, kind: "focus", conversationBound: true, externalSignal: input.signal });
    const bindingKey = `agent:${agentId}`;
    const focus = this.driver.focus.bind(this.driver);
    const attempt = async (): Promise<{ conversationUrl: string }> => {
      const traceId = `focus_${randomUUID().replaceAll("-", "")}`;
      const lease = await this.control.start({ traceId, bindingKey });
      this.markSurfaceBound(execution.runId);
      if (execution.runId) this.options.execution?.recordPhase(execution.runId, "lease-acquired");
      const heartbeat = this.heartbeat(traceId);
      try {
        const result = await focus({ surfaceId: lease.surfaceId, conversationUrl: input.conversationUrl, signal: execution.signal });
        await this.control.end({ traceId, status: "completed" });
        return result;
      } catch (error) {
        const aborted = isAbortError(error) || error instanceof CouncilSurfaceUnavailableError;
        await this.control.end({ traceId, status: aborted ? "aborted" : "failed", message: boundedFailureMessage(error) }).catch(() => {});
        throw error;
      } finally {
        heartbeat.stop();
      }
    };
    try {
      let result: { conversationUrl: string };
      try {
        result = await attempt();
      } catch (error) {
        if (!this.canRetrySurface(execution.runId, error, execution.signal)) throw error;
        await this.control.release!({ bindingKey });
        if (execution.signal?.aborted) throw new DOMException("Council browser focus aborted", "AbortError");
        result = await attempt();
      }
      this.completeExecution(execution.runId, true);
      return result;
    } catch (error) {
      this.failExecution(execution.runId, error);
      throw error;
    } finally {
      execution.dispose();
    }
  }

  async captureConversation(input: { agentId: string; conversationUrl: string; signal?: AbortSignal }): Promise<CouncilBrowserCaptureResult> {
    const agentId = validAgentId(input.agentId);
    if (!this.driver.capture) throw new Error("Council browser driver does not support observation capture");
    if (input.signal?.aborted) throw new DOMException("Council browser capture aborted", "AbortError");
    const execution = this.beginExecution({ agentId, kind: "capture", conversationBound: true, externalSignal: input.signal });
    const capture = this.driver.capture.bind(this.driver);
    const bindingKey = `agent:${agentId}`;
    let activeTraceId = "";
    let leased = false;
    const attempt = async (): Promise<CouncilBrowserCaptureResult> => {
      activeTraceId = `observe_${randomUUID().replaceAll("-", "")}`;
      const lease = await this.control.start({ traceId: activeTraceId, bindingKey });
      leased = true;
      this.markSurfaceBound(execution.runId);
      if (execution.runId) this.options.execution?.recordPhase(execution.runId, "lease-acquired");
      const heartbeat = this.heartbeat(activeTraceId);
      try {
        const result = await capture({ surfaceId: lease.surfaceId, conversationUrl: input.conversationUrl, signal: execution.signal });
        if (execution.runId) this.options.execution?.recordHealth(execution.runId, { health: result.health, ...(result.note ? { note: result.note } : {}) });
        await this.control.end({ traceId: activeTraceId, status: "completed" });
        return result;
      } catch (error) {
        const aborted = isAbortError(error) || error instanceof CouncilSurfaceUnavailableError;
        await this.control.end({ traceId: activeTraceId, status: aborted ? "aborted" : "failed", message: boundedFailureMessage(error) }).catch(() => {});
        throw error;
      } finally {
        heartbeat.stop();
      }
    };
    try {
      let result: CouncilBrowserCaptureResult;
      try {
        result = await attempt();
      } catch (error) {
        if (!this.canRetrySurface(execution.runId, error, execution.signal)) throw error;
        await this.control.release!({ bindingKey });
        leased = false;
        result = await attempt();
      }
      this.completeExecution(execution.runId, true);
      return result;
    } catch (error) {
      this.failExecution(execution.runId, error);
      throw error;
    } finally {
      execution.dispose();
      if (leased && this.control.release) await this.control.release({ bindingKey }).catch(() => false);
    }
  }

  async release(agentId: string): Promise<boolean> {
    const id = validAgentId(agentId);
    return this.control.release ? await this.control.release({ bindingKey: `agent:${id}` }) : false;
  }
}
