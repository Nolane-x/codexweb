import { describe, expect, test } from "bun:test";
import {
  assertCouncilExecutionPermission,
  requiredCouncilExecutionPermission,
} from "../src/council/execution-policy";

describe("Council execution command policy", () => {
  test("reuses the existing ACL vocabulary with least-powerful mappings", () => {
    expect(requiredCouncilExecutionPermission({ type: "focus", agentId: "critic" })).toBe("review");
    expect(requiredCouncilExecutionPermission({ type: "capture", agentId: "critic" })).toBe("review");
    expect(requiredCouncilExecutionPermission({ type: "cancel", runId: "run_1" })).toBe("wake");
    expect(requiredCouncilExecutionPermission({ type: "retry", runId: "run_1" })).toBe("wake");
  });

  test("rejects a non-managed actor instead of silently treating it as authorized", () => {
    expect(() => assertCouncilExecutionPermission(undefined, { type: "focus", agentId: "critic" })).toThrow(/managed Council participant/i);
  });

  test("rejects commands when the actor lacks the mapped permission", () => {
    const reviewer = { id: "reviewer", permissions: ["review"] as const };
    expect(() => assertCouncilExecutionPermission(reviewer, { type: "cancel", runId: "run_1" })).toThrow(/requires wake permission/i);
  });

  test("allows only the command families granted by existing permissions", () => {
    const reviewer = { id: "reviewer", permissions: ["review"] as const };
    const coordinator = { id: "coordinator", permissions: ["wake"] as const };
    expect(() => assertCouncilExecutionPermission(reviewer, { type: "capture", agentId: "critic" })).not.toThrow();
    expect(() => assertCouncilExecutionPermission(coordinator, { type: "retry", runId: "run_1" })).not.toThrow();
    expect(() => assertCouncilExecutionPermission(coordinator, { type: "focus", agentId: "critic" })).toThrow(/requires review permission/i);
  });
});
