import { randomUUID } from "node:crypto";
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

export interface CouncilPersistentChatDriver {
  resume(input: { surfaceId: string; conversationUrl: string; prompt: string; attachments?: CouncilPromptAttachment[]; signal?: AbortSignal }): Promise<{ answer: string; conversationUrl: string }>;
  create(input: { surfaceId: string; prompt: string; attachments?: CouncilPromptAttachment[]; signal?: AbortSignal }): Promise<{ answer: string; conversationUrl: string }>;
  capture(input: { surfaceId: string; conversationUrl: string; signal?: AbortSignal }): Promise<{ png: Buffer; conversationUrl: string; health: CouncilObservationHealth; note?: string }>;
}

export interface CouncilBrowserTransportRunInput {
  agentId: string;
  conversationUrl?: string;
  prompt: string;
  resurrectionPrompt?: string;
  attachments?: CouncilPromptAttachment[];
  signal?: AbortSignal;
}
export interface CouncilBrowserTransportResult { answer: string; conversationUrl: string; resumed: boolean }
export interface CouncilBrowserCaptureResult { png: Buffer; conversationUrl: string; health: CouncilObservationHealth; note?: string }

function validAgentId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error("agentId is invalid");
  return id;
}

export class CouncilBrowserTransport {
  private readonly control: CouncilPersistentTurnControl;
  private readonly driver: CouncilPersistentChatDriver;
  private readonly options: { heartbeatMs?: number };

  constructor(control: CouncilPersistentTurnControl, driver: CouncilPersistentChatDriver, options: { heartbeatMs?: number } = {}) {
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

  private async runAttempt(input: CouncilBrowserTransportRunInput, bindingKey: string): Promise<CouncilBrowserTransportResult> {
    const traceId = `council_${randomUUID().replaceAll("-", "")}`;
    const lease = await this.control.start({ traceId, bindingKey });
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
          });
        }
      } else {
        result = await this.driver.create({
          surfaceId: lease.surfaceId,
          prompt: input.resurrectionPrompt?.trim() || input.prompt,
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
          signal: input.signal,
        });
      }
      await this.control.end({ traceId, status: "completed" });
      return { ...result, resumed };
    } catch (error) {
      const aborted = (error instanceof DOMException && error.name === "AbortError") || error instanceof CouncilSurfaceUnavailableError;
      await this.control.end({ traceId, status: aborted ? "aborted" : "failed", message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }).catch(() => {});
      throw error;
    } finally {
      heartbeat.stop();
    }
  }

  async run(input: CouncilBrowserTransportRunInput): Promise<CouncilBrowserTransportResult> {
    const agentId = validAgentId(input.agentId);
    if (!input.prompt.trim()) throw new Error("prompt is required");
    if (input.signal?.aborted) throw new DOMException("Council browser turn aborted", "AbortError");
    const bindingKey = `agent:${agentId}`;
    try {
      return await this.runAttempt(input, bindingKey);
    } catch (error) {
      if (!(error instanceof CouncilSurfaceUnavailableError) || !this.control.release) throw error;
      await this.control.release({ bindingKey });
      if (input.signal?.aborted) throw new DOMException("Council browser turn aborted", "AbortError");
      return await this.runAttempt(input, bindingKey);
    }
  }

  async captureConversation(input: { agentId: string; conversationUrl: string; signal?: AbortSignal }): Promise<CouncilBrowserCaptureResult> {
    const agentId = validAgentId(input.agentId);
    if (input.signal?.aborted) throw new DOMException("Council browser capture aborted", "AbortError");
    const bindingKey = `agent:${agentId}`;
    const traceId = `observe_${randomUUID().replaceAll("-", "")}`;
    let lease: { surfaceId: string } | undefined;
    const run = async (): Promise<CouncilBrowserCaptureResult> => {
      lease = await this.control.start({ traceId, bindingKey });
      const heartbeat = this.heartbeat(traceId);
      try {
        const result = await this.driver.capture({ surfaceId: lease.surfaceId, conversationUrl: input.conversationUrl, signal: input.signal });
        await this.control.end({ traceId, status: "completed" });
        return result;
      } catch (error) {
        const aborted = (error instanceof DOMException && error.name === "AbortError") || error instanceof CouncilSurfaceUnavailableError;
        await this.control.end({ traceId, status: aborted ? "aborted" : "failed", message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }).catch(() => {});
        throw error;
      } finally {
        heartbeat.stop();
      }
    };
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof CouncilSurfaceUnavailableError) || !this.control.release) throw error;
      await this.control.release({ bindingKey });
      lease = undefined;
      return await run();
    } finally {
      if (lease && this.control.release) await this.control.release({ bindingKey }).catch(() => false);
    }
  }

  async release(agentId: string): Promise<boolean> {
    const id = validAgentId(agentId);
    return this.control.release ? await this.control.release({ bindingKey: `agent:${id}` }) : false;
  }
}
