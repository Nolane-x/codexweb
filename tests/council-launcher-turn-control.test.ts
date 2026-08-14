import { describe, expect, test } from "bun:test";
import { createLauncherPersistentTurnControl } from "../src/council/launcher-turn-control";

describe("launcher persistent turn control", () => {
  test("sends stable binding key only to authenticated loopback control channel", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const control = createLauncherPersistentTurnControl("/descriptor", {
      readDescriptor: () => ({ control: { endpoint: "http://127.0.0.1:4567", token: "secret-token" } }),
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ ok: true, surfaceId: "A".repeat(32) }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const lease = await control.start({ traceId: "trace_123", bindingKey: "agent:alice" });
    expect(lease.surfaceId).toBe("A".repeat(32));
    expect(calls[0]?.url).toBe("http://127.0.0.1:4567/v1/turn/start");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer secret-token");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ phase: "start", traceId: "trace_123", helperPid: process.pid, bindingKey: "agent:alice" });
  });

  test("fails closed on non-loopback descriptor", async () => {
    const control = createLauncherPersistentTurnControl("/descriptor", {
      readDescriptor: () => ({ control: { endpoint: "https://evil.example", token: "secret" } }),
      fetchImpl: fetch,
    });
    await expect(control.start({ traceId: "trace_123", bindingKey: "agent:alice" })).rejects.toThrow(/loopback/);
  });
});
