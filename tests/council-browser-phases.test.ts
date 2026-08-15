import { describe, expect, test } from "bun:test";
import { CouncilBrowserTransport } from "../src/council/browser-transport";

describe("CouncilBrowserTransport execution phases", () => {
  test("emits lease phase and forwards phase observer to the driver", async () => {
    const phases: string[] = [];
    const control = {
      async start() { return { surfaceId: "surface-1" }; },
      async heartbeat() {},
      async end() {},
      async release() { return true; },
    };
    const driver = {
      async create(input: { onPhase?: (phase: any) => void }) {
        for (const phase of ["conversation-ready", "connector-selected", "prompt-attached", "files-attached", "submit-started", "submit-observed", "response-streaming", "response-complete"] as const) input.onPhase?.(phase);
        return { answer: "ok", conversationUrl: "https://chatgpt.com/c/new" };
      },
      async resume() { throw new Error("not used"); },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 0 });
    await transport.run({ agentId: "worker", prompt: "hello", onPhase: phase => phases.push(phase) });
    expect(phases).toEqual([
      "lease-acquired",
      "conversation-ready",
      "connector-selected",
      "prompt-attached",
      "files-attached",
      "submit-started",
      "submit-observed",
      "response-streaming",
      "response-complete",
    ]);
  });

  test("phase persistence failure aborts before the driver progresses", async () => {
    let driverCalled = false;
    const control = {
      async start() { return { surfaceId: "surface-1" }; },
      async heartbeat() {},
      async end() {},
      async release() { return true; },
    };
    const driver = {
      async create() { driverCalled = true; return { answer: "bad", conversationUrl: "https://chatgpt.com/c/new" }; },
      async resume() { throw new Error("not used"); },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 0 });
    await expect(transport.run({ agentId: "worker", prompt: "hello", onPhase: () => { throw new Error("persist failed"); } })).rejects.toThrow(/persist failed/);
    expect(driverCalled).toBe(false);
  });
});
