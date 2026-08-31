import { describe, expect, test } from "bun:test";
import {
  CouncilExecutionControlPlane,
  deriveExecutionRetrySafety,
} from "../src/council/execution-control-plane";

function fixture(options: { maxRuns?: number; maxEventsPerRun?: number } = {}) {
  let now = Date.parse("2026-08-31T12:00:00.000Z");
  let sequence = 0;
  const plane = new CouncilExecutionControlPlane({
    now: () => now,
    id: prefix => `${prefix}_${++sequence}`,
    ...options,
  });
  return {
    plane,
    tick(ms = 1_000) { now += ms; },
  };
}

describe("CouncilExecutionControlPlane", () => {
  test("creates a safe public run without private browser continuity fields", () => {
    const { plane } = fixture();
    const run = plane.createRun({ traceId: "trace_1", agentId: "critic", kind: "turn", conversationBound: true });
    expect(run.runId).toBe("run_1");
    expect(run.status).toBe("active");
    expect(run.retrySafety).toBe("safe-before-submit");
    expect(run.surfaceBound).toBe(false);
    expect(run.conversationBound).toBe(true);
    const serialized = JSON.stringify(run);
    for (const forbidden of ["conversationUrl", "checkpoint", "prompt", "cookie", "token", "selector", "javascript"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(plane.events(run.runId).map(event => event.kind)).toEqual(["run-created"]);
  });

  test("records phases and derives the hard submission retry boundary", () => {
    const { plane, tick } = fixture();
    const run = plane.createRun({ traceId: "trace_1", agentId: "critic", kind: "turn" });
    tick();
    plane.recordPhase(run.runId, "conversation-ready");
    expect(plane.readRun(run.runId)?.retrySafety).toBe("safe-before-submit");
    tick();
    plane.recordPhase(run.runId, "submit-started");
    expect(plane.readRun(run.runId)?.retrySafety).toBe("forbidden-after-submit");
    expect(plane.events(run.runId).filter(event => event.kind === "phase")).toHaveLength(2);
  });

  test("deduplicates unchanged Deep State while retaining meaningful transitions", () => {
    const { plane, tick } = fixture();
    const run = plane.createRun({ traceId: "trace_1", agentId: "critic", kind: "turn" });
    plane.recordDeepState(run.runId, { state: "THINKING", confidence: 0.94, reason: "positive liveness" });
    tick();
    plane.recordDeepState(run.runId, { state: "THINKING", confidence: 0.95, reason: "same state, fresher signal" });
    tick();
    plane.recordDeepState(run.runId, { state: "DEEP_THINKING", confidence: 0.91, reason: "quiet but stop control remains" });
    const states = plane.events(run.runId).filter(event => event.kind === "deep-state").map(event => event.deepState);
    expect(states).toEqual(["THINKING", "DEEP_THINKING"]);
    expect(plane.readRun(run.runId)?.deepState).toBe("DEEP_THINKING");
  });

  test("marks waiting-user and uncertain states explicitly", () => {
    const { plane } = fixture();
    const waiting = plane.createRun({ traceId: "trace_wait", agentId: "critic", kind: "turn" });
    plane.recordDeepState(waiting.runId, { state: "WAITING_USER", confidence: 0.97, reason: "approval required" });
    expect(plane.readRun(waiting.runId)?.status).toBe("waiting-user");

    const uncertain = plane.createRun({ traceId: "trace_uncertain", agentId: "critic", kind: "turn" });
    plane.recordPhase(uncertain.runId, "submit-started");
    plane.failRun(uncertain.runId, { failureCode: "SUBMISSION_UNCERTAIN", message: "delivery cannot be disproven", uncertain: true });
    const value = plane.readRun(uncertain.runId)!;
    expect(value.status).toBe("uncertain");
    expect(value.retrySafety).toBe("operator-resolution-required");
  });

  test("caps events per run but preserves the creation event and latest evidence", () => {
    const { plane, tick } = fixture({ maxEventsPerRun: 4 });
    const run = plane.createRun({ traceId: "trace_1", agentId: "critic", kind: "turn" });
    for (const phase of ["lease-acquired", "conversation-ready", "prompt-attached", "files-attached", "submit-started"] as const) {
      tick();
      plane.recordPhase(run.runId, phase);
    }
    const events = plane.events(run.runId);
    expect(events).toHaveLength(4);
    expect(events[0]?.kind).toBe("run-created");
    expect(events.at(-1)?.phase).toBe("submit-started");
  });

  test("evicts oldest terminal runs first and never evicts an active run", () => {
    const { plane, tick } = fixture({ maxRuns: 2 });
    const active = plane.createRun({ traceId: "trace_active", agentId: "lead", kind: "turn" });
    tick();
    const old = plane.createRun({ traceId: "trace_old", agentId: "critic", kind: "focus" });
    plane.completeRun(old.runId);
    tick();
    const newest = plane.createRun({ traceId: "trace_new", agentId: "reviewer", kind: "capture" });
    expect(plane.readRun(active.runId)).toBeDefined();
    expect(plane.readRun(old.runId)).toBeUndefined();
    expect(plane.readRun(newest.runId)).toBeDefined();
  });

  test("records accepted and rejected command receipts immutably", () => {
    const { plane, tick } = fixture();
    const run = plane.createRun({ traceId: "trace_1", agentId: "critic", kind: "turn" });
    const rejected = plane.recordCommandReceipt({ commandType: "retry", actorId: "alice", targetRunId: run.runId, outcome: "rejected", reason: "submission boundary reached" });
    tick();
    const accepted = plane.recordCommandReceipt({ commandType: "cancel", actorId: "lead", targetRunId: run.runId, outcome: "accepted", reason: "active local turn aborted" });
    expect(plane.receipts().map(receipt => receipt.receiptId)).toEqual([rejected.receiptId, accepted.receiptId]);
    expect(Object.isFrozen(plane.receipts()[0]!)).toBe(true);
  });
});

describe("deriveExecutionRetrySafety", () => {
  test("never crosses submit-started and reserves uncertain work for operator resolution", () => {
    expect(deriveExecutionRetrySafety({ phase: "conversation-ready", status: "failed", failureCode: "SURFACE_UNAVAILABLE" })).toBe("safe-before-submit");
    expect(deriveExecutionRetrySafety({ phase: "submit-started", status: "failed", failureCode: "CONNECTION_FAILED" })).toBe("forbidden-after-submit");
    expect(deriveExecutionRetrySafety({ phase: "submit-observed", status: "failed", failureCode: "CONNECTION_FAILED" })).toBe("forbidden-after-submit");
    expect(deriveExecutionRetrySafety({ phase: "submit-started", status: "uncertain", failureCode: "SUBMISSION_UNCERTAIN" })).toBe("operator-resolution-required");
    expect(deriveExecutionRetrySafety({ status: "completed" })).toBe("forbidden-after-submit");
    expect(deriveExecutionRetrySafety({ status: "waiting-user" })).toBe("forbidden-after-submit");
    expect(deriveExecutionRetrySafety({ status: "failed", failureCode: "CHATGPT_LIMITED" })).toBe("forbidden-after-submit");
  });
});
