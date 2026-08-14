import { randomUUID } from "node:crypto";

export class CouncilConversationUnavailableError extends Error {
  constructor(message = "Council conversation is unavailable") { super(message); this.name = "CouncilConversationUnavailableError"; }
}

export interface CouncilPersistentTurnControl {
  start(input: { traceId: string; bindingKey: string }): Promise<{ surfaceId: string }>;
  heartbeat(input: { traceId: string }): Promise<void>;
  end(input: { traceId: string; status: "completed" | "failed" | "aborted"; message?: string }): Promise<void>;
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

  async run(input: CouncilBrowserTransportRunInput): Promise<CouncilBrowserTransportResult> {
    const agentId = input.agentId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(agentId)) throw new Error("agentId is invalid");
    if (!input.prompt.trim()) throw new Error("prompt is required");
    if (input.signal?.aborted) throw new DOMException("Council browser turn aborted", "AbortError");
    const traceId = `council_${randomUUID().replaceAll("-", "")}`;
    const bindingKey = `agent:${agentId}`;
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
      const aborted = error instanceof DOMException && error.name === "AbortError";
      await this.control.end({ traceId, status: aborted ? "aborted" : "failed", message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }).catch(() => {});
      throw error;
    } finally {
      if (timer) clearInterval(timer);
    }
  }
}
