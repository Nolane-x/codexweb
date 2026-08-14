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

  test("allows finalization after proposal and all blockers settle", () => {
    const value = state();
    value.messages.push({ id: "p1", roomId: "core", authorAgentId: "alice", kind: "proposal", body: "X2", threadId: "p1", mentions: [], createdAt: "" });
    value.tasks.push({ id: "t1", roomId: "core", createdByAgentId: "alice", title: "Risk", description: "Fixed", status: "done", createdAt: "", updatedAt: "" });
    value.wakes.push({ id: "w1", targetAgentId: "bob", roomId: "core", reason: "Review", status: "acknowledged", attempts: 1, createdAt: "", updatedAt: "" });
    expect(evaluateCouncilDecisionGate(value, "core").ready).toBe(true);
  });
});
