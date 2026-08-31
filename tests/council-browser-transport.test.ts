import { describe, expect, test } from "bun:test";
import { CouncilBrowserTransport, CouncilConversationUnavailableError, CouncilSurfaceUnavailableError } from "../src/council/browser-transport";

function fixture() {
  const events: string[] = [];
  let starts = 0;
  const control = {
    async start(input: { bindingKey: string }) { starts += 1; events.push(`start:${input.bindingKey}:${starts}`); return { surfaceId: `surface-${starts}` }; },
    async heartbeat() { events.push("heartbeat"); },
    async end(input: { status: string }) { events.push(`end:${input.status}`); },
    async release(input: { bindingKey: string }) { events.push(`release:${input.bindingKey}`); return true; },
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
    expect(events).toEqual(["start:agent:bob:1", "end:completed"]);
  });

  test("forwards screenshot attachments to a manager turn", async () => {
    const { events, control } = fixture();
    const image = Buffer.from("png");
    const driver = {
      async resume(input: { attachments?: Array<{ name: string; buffer: Buffer }> }) {
        expect(input.attachments).toHaveLength(1);
        expect(input.attachments?.[0].name).toBe("critic.png");
        expect(input.attachments?.[0].buffer).toEqual(image);
        return { answer: "managed", conversationUrl: "https://chatgpt.com/c/lead" };
      },
      async create() { throw new Error("must not create"); },
    };
    const transport = new CouncilBrowserTransport(control, driver as any, { heartbeatMs: 60_000 });
    const result = await transport.run({
      agentId: "lead",
      conversationUrl: "https://chatgpt.com/c/lead",
      prompt: "inspect",
      attachments: [{ name: "critic.png", mimeType: "image/png", buffer: image }],
    });
    expect(result.answer).toBe("managed");
    expect(events).toEqual(["start:agent:lead:1", "end:completed"]);
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
    expect(events).toEqual(["start:agent:bob:1", "end:completed"]);
  });

  test("focuses a persisted conversation without submitting and keeps the agent binding", async () => {
    const { events, control } = fixture();
    let sends = 0;
    const driver = {
      async resume() { sends += 1; throw new Error("focus must not submit"); },
      async create() { sends += 1; throw new Error("focus must not create"); },
      async focus(input: { surfaceId: string; conversationUrl: string }) {
        expect(input.surfaceId).toBe("surface-1");
        expect(input.conversationUrl).toBe("https://chatgpt.com/c/bob");
        return { conversationUrl: input.conversationUrl };
      },
    };
    const transport = new CouncilBrowserTransport(control, driver as any, { heartbeatMs: 60_000 });
    const result = await transport.focusConversation({ agentId: "bob", conversationUrl: "https://chatgpt.com/c/bob" });
    expect(result.conversationUrl).toBe("https://chatgpt.com/c/bob");
    expect(sends).toBe(0);
    expect(events).toEqual(["start:agent:bob:1", "end:completed"]);
  });

  test("focus releases one stale surface and reacquires exactly once", async () => {
    const { events, control } = fixture();
    let focuses = 0;
    const driver = {
      async resume() { throw new Error("unused"); },
      async create() { throw new Error("unused"); },
      async focus(input: { surfaceId: string; conversationUrl: string }) {
        focuses += 1;
        if (focuses === 1) throw new CouncilSurfaceUnavailableError("stale parked surface");
        expect(input.surfaceId).toBe("surface-2");
        return { conversationUrl: input.conversationUrl };
      },
    };
    const transport = new CouncilBrowserTransport(control, driver as any, { heartbeatMs: 60_000 });
    await transport.focusConversation({ agentId: "bob", conversationUrl: "https://chatgpt.com/c/bob" });
    expect(focuses).toBe(2);
    expect(events).toEqual([
      "start:agent:bob:1",
      "end:aborted",
      "release:agent:bob",
      "start:agent:bob:2",
      "end:completed",
    ]);
  });

  test("captures a conversation read-only and releases its persistent browser binding", async () => {
    const { events, control } = fixture();
    let sends = 0;
    const driver = {
      async resume() { sends += 1; throw new Error("capture must not send"); },
      async create() { sends += 1; throw new Error("capture must not create"); },
      async capture(input: { surfaceId: string; conversationUrl: string }) {
        expect(input.surfaceId).toBe("surface-1");
        expect(input.conversationUrl).toBe("https://chatgpt.com/c/bob");
        return { png: Buffer.from("png"), conversationUrl: input.conversationUrl, health: "healthy" as const };
      },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 60_000 });
    const result = await transport.captureConversation({ agentId: "bob", conversationUrl: "https://chatgpt.com/c/bob" });
    expect(result.health).toBe("healthy");
    expect(result.png).toEqual(Buffer.from("png"));
    expect(sends).toBe(0);
    expect(events).toEqual(["start:agent:bob:1", "end:completed", "release:agent:bob"]);
  });

  test("releases and reacquires exactly once when the leased browser surface is unavailable before submit", async () => {
    const { events, control } = fixture();
    let resumes = 0;
    const driver = {
      async resume(input: { surfaceId: string; conversationUrl: string }) {
        resumes += 1;
        if (resumes === 1) {
          expect(input.surfaceId).toBe("surface-1");
          throw new CouncilSurfaceUnavailableError("about:blank surface before submit");
        }
        expect(input.surfaceId).toBe("surface-2");
        return { answer: "recovered", conversationUrl: input.conversationUrl };
      },
      async create() { throw new Error("must not create"); },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 60_000 });
    const result = await transport.run({ agentId: "bob", conversationUrl: "https://chatgpt.com/c/bob", prompt: "review" });
    expect(result.answer).toBe("recovered");
    expect(resumes).toBe(2);
    expect(events).toEqual([
      "start:agent:bob:1",
      "end:aborted",
      "release:agent:bob",
      "start:agent:bob:2",
      "end:completed",
    ]);
  });

  test("does not duplicate a turn by treating arbitrary send errors as missing conversation", async () => {
    const { events, control } = fixture();
    let creates = 0;
    const driver = { async resume() { throw new Error("network timeout after send"); }, async create() { creates += 1; return { answer: "bad", conversationUrl: "https://chatgpt.com/c/new" }; } };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 60_000 });
    await expect(transport.run({ agentId: "bob", conversationUrl: "https://chatgpt.com/c/old", prompt: "wake", resurrectionPrompt: "full" })).rejects.toThrow(/network timeout/);
    expect(creates).toBe(0);
    expect(events).toEqual(["start:agent:bob:1", "end:failed"]);
  });
});
