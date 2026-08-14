import { describe, expect, test } from "bun:test";
import { CouncilBrowserTransport, CouncilConversationUnavailableError } from "../src/council/browser-transport";

function fixture() {
  const events: string[] = [];
  const control = {
    async start(input: { bindingKey: string }) { events.push(`start:${input.bindingKey}`); return { surfaceId: "surface-1" }; },
    async heartbeat() { events.push("heartbeat"); },
    async end(input: { status: string }) { events.push(`end:${input.status}`); },
  };
  return { events, control };
}

describe("CouncilBrowserTransport", () => {
  test("resumes exact persistent conversation when available", async () => {
    const { events, control } = fixture();
    const driver = {
      async resume(input: { surfaceId: string; conversationUrl: string }) { expect(input.surfaceId).toBe("surface-1"); expect(input.conversationUrl).toBe("https://chatgpt.com/c/bob"); return { answer: "review", conversationUrl: input.conversationUrl }; },
      async create() { throw new Error("must not create"); },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 60_000 });
    const result = await transport.run({ agentId: "bob", conversationUrl: "https://chatgpt.com/c/bob", prompt: "review" });
    expect(result.resumed).toBe(true);
    expect(result.answer).toBe("review");
    expect(events).toEqual(["start:agent:bob", "end:completed"]);
  });

  test("falls back to new conversation only for explicit unavailable evidence", async () => {
    const { events, control } = fixture();
    const driver = {
      async resume() { throw new CouncilConversationUnavailableError("404"); },
      async create() { return { answer: "resurrected", conversationUrl: "https://chatgpt.com/c/new" }; },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 60_000 });
    const result = await transport.run({ agentId: "bob", conversationUrl: "https://chatgpt.com/c/old", prompt: "wake", resurrectionPrompt: "full state" });
    expect(result.resumed).toBe(false);
    expect(result.conversationUrl).toBe("https://chatgpt.com/c/new");
    expect(events).toEqual(["start:agent:bob", "end:completed"]);
  });

  test("does not duplicate a turn by treating arbitrary send errors as missing conversation", async () => {
    const { events, control } = fixture();
    let creates = 0;
    const driver = { async resume() { throw new Error("network timeout after send"); }, async create() { creates += 1; return { answer: "bad", conversationUrl: "https://chatgpt.com/c/new" }; } };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 60_000 });
    await expect(transport.run({ agentId: "bob", conversationUrl: "https://chatgpt.com/c/old", prompt: "wake", resurrectionPrompt: "full" })).rejects.toThrow(/network timeout/);
    expect(creates).toBe(0);
    expect(events).toEqual(["start:agent:bob", "end:failed"]);
  });
});
