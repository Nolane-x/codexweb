import { randomUUID } from "node:crypto";

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

export interface CouncilPersistentChatDriver {
  resume(input: { surfaceId: string; conversationUrl: string; prompt: string; signal?: AbortSignal }): Promise<{ answer: string; conversationUrl: string }>;
  create(input: { surfaceId: string; prompt: string; signal?: AbortSignal }): Promise<{ answer: string; conversationUrl: string }>;
}

export interface CouncilBrowserTransportRunInput {
  agentId: string;
  conversationUrl?: string;
  prompt: string;
  resurrectionPrompt?: string;
  signal?: AbortSignal;
}
export interface CouncilBrowserTransportResult { answer: string; conversationUrl: string; resumed: boolean }

export class CouncilBrowserTransport {
  private readonly control: CouncilPersistentTurnControl;
  private readonly driver: CouncilPersistentChatDriver;
  private readonly options: { heartbeatMs?: number };

  constructor(control: CouncilPersistentTurnControl, driver: CouncilPersistentChatDriver, options: { heartbeatMs?: number } = {}) {
    this.control = control;
    this.driver = driver;
    this.options = options;
  }

  private async runAttempt(input: CouncilBrowserTransportRunInput, bindingKey: string): Promise<CouncilBrowserTransportResult> {
    const traceId = `council_${randomUUID().replaceAll("-", "")}`;
    const lease = await this.control.start({ traceId, bindingKey });
    let timer: ReturnType<typeof setInterval> | undefined;
    const heartbeatMs = this.options.heartbeatMs ?? 10_000;
    if (heartbeatMs > 0) {
      timer = setInterval(() => { void this.control.heartbeat({ traceId }).catch(() => {}); }, heartbeatMs);
      timer.unref?.();
    }
    try {
      let result: { answer: string; conversationUrl: string };
      let resumed = false;
      if (input.conversationUrl) {
        try {
          result = await this.driver.resume({ surfaceId: lease.surfaceId, conversationUrl: input.conversationUrl, prompt: input.prompt, signal: input.signal });
          resumed = true;
        } catch (error) {
          if (!(error instanceof CouncilConversationUnavailableError)) throw error;
          const resurrection = input.resurrectionPrompt?.trim();
          if (!resurrection) throw error;
          result = await this.driver.create({ surfaceId: lease.surfaceId, prompt: resurrection, signal: input.signal });
        }
      } else {
        result = await this.driver.create({ surfaceId: lease.surfaceId, prompt: input.resurrectionPrompt?.trim() || input.prompt, signal: input.signal });
      }
      await this.control.end({ traceId, status: "completed" });
      return { ...result, resumed };
    } catch (error) {
      const aborted = (error instanceof DOMException && error.name === "AbortError") || error instanceof CouncilSurfaceUnavailableError;
      await this.control.end({ traceId, status: aborted ? "aborted" : "failed", message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }).catch(() => {});
      throw error;
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  async run(input: CouncilBrowserTransportRunInput): Promise<CouncilBrowserTransportResult> {
    const agentId = input.agentId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(agentId)) throw new Error("agentId is invalid");
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

  async release(agentId: string): Promise<boolean> {
    const id = agentId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error("agentId is invalid");
    return this.control.release ? await this.control.release({ bindingKey: `agent:${id}` }) : false;
  }
}
