import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilAutonomyBudgetLedger, DEFAULT_COUNCIL_AUTONOMY_POLICY } from "../src/council/autonomy-policy";

describe("Council autonomy policy", () => {
  test("uses bounded default budgets", () => {
    expect(DEFAULT_COUNCIL_AUTONOMY_POLICY).toMatchObject({
      maxManagedTurnsPerProjectHour: 60,
      maxAutomaticWakesPerTargetHour: 12,
      maxAutomaticSpawnsPerProjectHour: 6,
      maxConsecutiveRecoveryAttempts: 6,
      maxActiveItemsPerProject: 200,
      equivalentWakeCooldownMs: 60_000,
      maxCorrelationDepth: 12,
      maxQueuedAgeMs: 6 * 60 * 60 * 1_000,
    });
  });

  test("blocks wake and turn storms without silently consuming more budget", () => {
    const root = mkdtempSync(join(tmpdir(), "council-budget-"));
    let now = Date.parse("2026-08-15T00:00:00Z");
    try {
      const ledger = new CouncilAutonomyBudgetLedger(join(root, "budget.json"), { now: () => now });
      for (let i = 0; i < 12; i++) ledger.recordExecution({ projectRoomId: "r", type: "wake", targetAgentId: "bob" });
      const denied = ledger.checkIntent({ projectRoomId: "r", kind: "wake", targetAgentId: "bob", activeItems: 0, correlationDepth: 1 });
      expect(denied.allowed).toBe(false);
      expect(denied.code).toBe("POLICY_BUDGET_EXHAUSTED");
      now += 60 * 60 * 1_000 + 1;
      expect(ledger.checkIntent({ projectRoomId: "r", kind: "wake", targetAgentId: "bob", activeItems: 0, correlationDepth: 1 }).allowed).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("blocks excessive active items and correlation depth", () => {
    const root = mkdtempSync(join(tmpdir(), "council-budget-depth-"));
    try {
      const ledger = new CouncilAutonomyBudgetLedger(join(root, "budget.json"));
      expect(ledger.checkIntent({ projectRoomId: "r", kind: "wake", targetAgentId: "bob", activeItems: 201, correlationDepth: 1 }).allowed).toBe(false);
      expect(ledger.checkIntent({ projectRoomId: "r", kind: "wake", targetAgentId: "bob", activeItems: 1, correlationDepth: 13 }).allowed).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
