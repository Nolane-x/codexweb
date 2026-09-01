import { describe, expect, test } from "bun:test";
import { CouncilBrowserTransport, type CouncilExecutionObservation } from "../src/council/browser-transport";

describe("Council typed execution observations", () => {
  test("keeps legacy phase callbacks while adding typed phase and Deep State telemetry", async () => {
    const legacy: string[] = [];
    const observations: CouncilExecutionObservation[] = [];
    const control = {
      async start() { return { surfaceId: "surface-1" }; },
      async heartbeat() {},
      async end() {},
    };
    const driver = {
      async resume(input: any) {
        input.onPhase?.("conversation-ready");
        input.onExecution?.({ type: "phase", phase: "conversation-ready" });
        input.onExecution?.({ type: "deep-state", state: "THINKING", confidence: 0.94, reason: "response liveness is positive" });
        return { answer: "ok", conversationUrl: input.conversationUrl };
      },
      async create() { throw new Error("unused"); },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 60_000 });
    await transport.run({
      agentId: "critic",
      conversationUrl: "https://chatgpt.com/c/critic",
      prompt: "review",
      onPhase: phase => legacy.push(phase),
      onExecution: observation => observations.push(observation),
    });
    expect(legacy).toEqual(["lease-acquired", "conversation-ready"]);
    expect(observations).toEqual([
      { type: "phase", phase: "lease-acquired" },
      { type: "phase", phase: "conversation-ready" },
      { type: "deep-state", state: "THINKING", confidence: 0.94, reason: "response liveness is positive" },
    ]);
  });
});
