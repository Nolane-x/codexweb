import { describe, expect, test } from "bun:test";
import {
  CouncilBrowserTransport,
  CouncilSurfaceUnavailableError,
  type CouncilExecutionTelemetryObserver,
  type CouncilPersistentChatDriver,
  type CouncilPersistentTurnControl,
} from "../src/council/browser-transport";
import { CouncilExecutionControlPlane } from "../src/council/execution-control-plane";

function executionFixture() {
  let sequence = 0;
  const execution = new CouncilExecutionControlPlane({
    now: () => Date.parse("2026-08-31T13:00:00.000Z") + sequence,
    id: prefix => `${prefix}_${++sequence}`,
  });
  return execution;
}

function abortError(message = "aborted"): DOMException {
  return new DOMException(message, "AbortError");
}

function waitForAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return reject(new Error("expected merged abort signal"));
    if (signal.aborted) return reject(abortError());
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

async function nextTurn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class FakeTurnControl implements CouncilPersistentTurnControl {
  readonly starts: string[] = [];
  readonly ends: Array<{ traceId: string; status: "completed" | "failed" | "aborted" }> = [];
  releases = 0;

  async start(input: { traceId: string; bindingKey: string }): Promise<{ surfaceId: string }> {
    this.starts.push(input.traceId);
    return { surfaceId: `surface_${this.starts.length}` };
  }
  async heartbeat(): Promise<void> {}
  async end(input: { traceId: string; status: "completed" | "failed" | "aborted" }): Promise<void> {
    this.ends.push({ traceId: input.traceId, status: input.status });
  }
  async release(): Promise<boolean> {
    this.releases += 1;
    return true;
  }
}

describe("Council browser execution control integration", () => {
  test("creates one public run before lease and completes it from typed telemetry", async () => {
    const execution = executionFixture();
    const control = new FakeTurnControl();
    let observedRunBeforeDriver = false;
    const driver: CouncilPersistentChatDriver = {
      async create(input) {
        observedRunBeforeDriver = execution.listRuns().length === 1;
        input.onExecution?.({ type: "phase", phase: "conversation-ready" });
        input.onExecution?.({ type: "deep-state", state: "THINKING", confidence: 0.93, reason: "generation active" });
        input.onExecution?.({ type: "phase", phase: "submit-started" });
        input.onExecution?.({ type: "phase", phase: "submit-observed" });
        input.onExecution?.({ type: "deep-state", state: "COMPLETED", confidence: 0.99, reason: "stable completion" });
        input.onExecution?.({ type: "phase", phase: "response-complete" });
        return { answer: "done", conversationUrl: "https://chatgpt.com/c/example" };
      },
      async resume() { throw new Error("not used"); },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 0, execution });

    const result = await transport.run({ agentId: "critic", prompt: "Review this" });

    expect(result.answer).toBe("done");
    expect(observedRunBeforeDriver).toBe(true);
    expect(execution.listRuns()).toHaveLength(1);
    const run = execution.listRuns()[0]!;
    expect(run.kind).toBe("turn");
    expect(run.status).toBe("completed");
    expect(run.surfaceBound).toBe(true);
    expect(run.conversationBound).toBe(true);
    expect(run.phase).toBe("response-complete");
    expect(run.deepState).toBe("COMPLETED");
  });

  test("cancel before submit aborts the local operation without claiming uncertainty", async () => {
    const execution = executionFixture();
    const control = new FakeTurnControl();
    let driverEntered!: () => void;
    const entered = new Promise<void>(resolve => { driverEntered = resolve; });
    const driver: CouncilPersistentChatDriver = {
      async create(input) {
        input.onExecution?.({ type: "phase", phase: "conversation-ready" });
        driverEntered();
        return await waitForAbort(input.signal);
      },
      async resume() { throw new Error("not used"); },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 0, execution });
    const pending = transport.run({ agentId: "critic", prompt: "Review this" });
    await entered;
    const runId = execution.listRuns()[0]!.runId;

    const cancelled = execution.cancelRun(runId, "operator requested cancellation");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    expect(cancelled.status).toBe("aborted");
    expect(cancelled.failureCode).toBeUndefined();
    expect(execution.readRun(runId)?.status).toBe("aborted");
    expect(control.ends.at(-1)?.status).toBe("aborted");
  });

  test("cancel at submit-started becomes uncertain and never retries the external submission", async () => {
    const execution = executionFixture();
    const control = new FakeTurnControl();
    let submitted!: () => void;
    const reachedSubmit = new Promise<void>(resolve => { submitted = resolve; });
    let createCalls = 0;
    const driver: CouncilPersistentChatDriver = {
      async create(input) {
        createCalls += 1;
        input.onExecution?.({ type: "phase", phase: "conversation-ready" });
        input.onExecution?.({ type: "phase", phase: "prompt-attached" });
        input.onExecution?.({ type: "phase", phase: "files-attached" });
        input.onExecution?.({ type: "phase", phase: "submit-started" });
        submitted();
        return await waitForAbort(input.signal);
      },
      async resume() { throw new Error("not used"); },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 0, execution });
    const pending = transport.run({ agentId: "critic", prompt: "Review this" });
    await reachedSubmit;
    const runId = execution.listRuns()[0]!.runId;

    const cancelled = execution.cancelRun(runId, "operator cancelled after local submit boundary");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    expect(cancelled.status).toBe("uncertain");
    expect(cancelled.failureCode).toBe("SUBMISSION_UNCERTAIN");
    expect(cancelled.retrySafety).toBe("operator-resolution-required");
    expect(createCalls).toBe(1);
    expect(control.starts).toHaveLength(1);
  });

  test("surface reacquire stays inside one execution run and retries only before submit", async () => {
    const execution = executionFixture();
    const control = new FakeTurnControl();
    let calls = 0;
    const driver: CouncilPersistentChatDriver = {
      async create(input) {
        calls += 1;
        if (calls === 1) throw new CouncilSurfaceUnavailableError("first leased surface disappeared before submit");
        input.onExecution?.({ type: "phase", phase: "conversation-ready" });
        input.onExecution?.({ type: "phase", phase: "submit-started" });
        input.onExecution?.({ type: "phase", phase: "submit-observed" });
        input.onExecution?.({ type: "phase", phase: "response-complete" });
        return { answer: "recovered", conversationUrl: "https://chatgpt.com/c/recovered" };
      },
      async resume() { throw new Error("not used"); },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 0, execution });

    const result = await transport.run({ agentId: "critic", prompt: "Review this" });

    expect(result.answer).toBe("recovered");
    expect(calls).toBe(2);
    expect(control.starts).toHaveLength(2);
    expect(control.releases).toBe(1);
    expect(execution.listRuns()).toHaveLength(1);
    expect(execution.listRuns()[0]?.status).toBe("completed");
  });

  test("focus and capture are represented as independent observable runs", async () => {
    const execution = executionFixture();
    const control = new FakeTurnControl();
    const driver: CouncilPersistentChatDriver = {
      async create() { throw new Error("not used"); },
      async resume() { throw new Error("not used"); },
      async focus(input) { return { conversationUrl: input.conversationUrl }; },
      async capture(input) { return { png: Buffer.from("png"), conversationUrl: input.conversationUrl, health: "healthy" }; },
    };
    const transport = new CouncilBrowserTransport(control, driver, { heartbeatMs: 0, execution });

    await transport.focusConversation({ agentId: "critic", conversationUrl: "https://chatgpt.com/c/a" });
    await transport.captureConversation({ agentId: "critic", conversationUrl: "https://chatgpt.com/c/a" });

    const runs = execution.listRuns();
    expect(runs.map(run => run.kind).sort()).toEqual(["capture", "focus"]);
    expect(runs.every(run => run.status === "completed" && run.surfaceBound)).toBe(true);
  });
});
