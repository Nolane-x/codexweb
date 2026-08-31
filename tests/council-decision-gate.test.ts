import { describe, expect, test } from "bun:test";
import { evaluateCouncilDecisionGate } from "../src/council/decision-gate";

function state(): any {
  return { version: 1, agents: [], credentials: [], rooms: [], messages: [], decisions: [], tasks: [], wakes: [], checkpoints: [] };
}

describe("Council decision gate", () => {
  test("requires an explicit proposal", () => {
    const result = evaluateCouncilDecisionGate(state(), "core");
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/proposal/);
  });

  test("blocks finalization while blocked work or active wake remains", () => {
    const value = state();
    value.messages.push({ id: "p1", roomId: "core", authorAgentId: "alice", kind: "proposal", body: "X", threadId: "p1", mentions: [], createdAt: "" });
    value.tasks.push({ id: "t1", roomId: "core", createdByAgentId: "alice", title: "Risk", description: "Fix", status: "blocked", createdAt: "", updatedAt: "" });
    value.wakes.push({ id: "w1", targetAgentId: "bob", roomId: "core", reason: "Review", status: "pending", attempts: 0, createdAt: "", updatedAt: "" });
    const result = evaluateCouncilDecisionGate(value, "core");
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/blocked/);
    expect(result.reasons.join(" ")).toMatch(/wake/);
  });

  test("allows finalization after proposal, independent critique and all blockers settle", () => {
    const value = state();
    value.messages.push({ id: "p1", roomId: "core", authorAgentId: "alice", kind: "proposal", body: "X2", threadId: "p1", mentions: [], createdAt: "" });
    value.tasks.push({ id: "t1", roomId: "core", createdByAgentId: "alice", title: "Risk", description: "Fixed", status: "done", createdAt: "", updatedAt: "" });
    value.wakes.push({ id: "w1", targetAgentId: "bob", roomId: "core", reason: "Review", status: "acknowledged", attempts: 1, createdAt: "", updatedAt: "" });
    value.messages.push({ id: "r1", roomId: "core", authorAgentId: "bob", kind: "message", body: "Reviewed", threadId: "p1", replyTo: "p1", mentions: [], createdAt: "" });
    expect(evaluateCouncilDecisionGate(value, "core").ready).toBe(true);
  });

  test("requires critique on the latest proposal rather than accepting an old thread", () => {
    const value = state();
    value.messages.push({ id: "p1", roomId: "core", authorAgentId: "alice", kind: "proposal", body: "Old", threadId: "p1", mentions: [], createdAt: "2026-08-31T00:00:00.000Z" });
    value.messages.push({ id: "r1", roomId: "core", authorAgentId: "bob", kind: "message", body: "Old critique", threadId: "p1", replyTo: "p1", mentions: [], createdAt: "2026-08-31T00:00:01.000Z" });
    value.messages.push({ id: "p2", roomId: "core", authorAgentId: "alice", kind: "proposal", body: "Latest", threadId: "p2", mentions: ["bob"], createdAt: "2026-08-31T00:00:02.000Z" });
    value.tasks.push({ id: "t1", roomId: "core", createdByAgentId: "alice", assigneeAgentId: "bob", title: "Review", description: "Review latest", status: "done", createdAt: "", updatedAt: "" });
    let result = evaluateCouncilDecisionGate(value, "core");
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/independent/i);
    value.messages.push({ id: "r2", roomId: "core", authorAgentId: "bob", kind: "message", body: "Latest critique", threadId: "p2", replyTo: "p2", mentions: [], createdAt: "2026-08-31T00:00:03.000Z" });
    result = evaluateCouncilDecisionGate(value, "core");
    expect(result.ready).toBe(true);
  });
});
