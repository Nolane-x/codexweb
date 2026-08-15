import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilAutonomyAuditStore } from "../src/council/autonomy-audit";
import { CouncilAutonomyDispatcher } from "../src/council/autonomy-dispatcher";
import { CouncilAutonomyError } from "../src/council/autonomy-errors";
import { CouncilAutonomyBudgetLedger } from "../src/council/autonomy-policy";
import { CouncilAutonomyWorkStore } from "../src/council/autonomy-work-store";
import { CouncilAgentHealthLedger } from "../src/council/agent-health";

function fixture(execute: ConstructorParameters<typeof CouncilAutonomyDispatcher>[0]["execute"]) {
  const root = mkdtempSync(join(tmpdir(), "council-dispatcher-"));
  let now = Date.parse("2026-08-15T00:00:00Z");
  const options = { now: () => now };
  const work = new CouncilAutonomyWorkStore(join(root, "work.json"), options);
  const audit = new CouncilAutonomyAuditStore(join(root, "audit.json"), options);
  const health = new CouncilAgentHealthLedger(join(root, "health.json"), options);
  const budget = new CouncilAutonomyBudgetLedger(join(root, "budget.json"), options);
  const dispatcher = new CouncilAutonomyDispatcher({ work, audit, health, budget, execute, now: () => now, random: () => 0 });
  return { root, work, audit, health, budget, dispatcher, advance: (ms: number) => { now += ms; } };
}

describe("CouncilAutonomyDispatcher", () => {
  test("executes one durable item and persists phases before completion", async () => {
    const fx = fixture(async (_item, hooks) => {
      hooks.onPhase("conversation-ready");
      hooks.onPhase("submit-started");
      hooks.onPhase("submit-observed");
      hooks.onPhase("response-complete");
    });
    try {
      const item = fx.work.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "bob", dedupeKey: "wake:r:bob:t", priority: 90 });
      expect(await fx.dispatcher.runOnce()).toBe(true);
      expect(fx.work.snapshot().items.find(value => value.id === item.id)?.state).toBe("completed");
      expect(fx.health.get("bob")?.state).toBe("healthy");
      expect(fx.audit.list(50).some(event => event.transition === "completed")).toBe(true);
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  });

  test("retries only a pre-submit structured transient failure after the breaker cooldown", async () => {
    let calls = 0;
    const fx = fixture(async (_item, hooks) => {
      calls += 1;
      hooks.onPhase("prompt-attached");
      if (calls === 1) throw new CouncilAutonomyError("CAPACITY_BUSY", "busy", true);
    });
    try {
      const item = fx.work.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "bob", dedupeKey: "retry", priority: 90, maxAttempts: 3 });
      await fx.dispatcher.runOnce();
      expect(fx.work.snapshot().items.find(value => value.id === item.id)?.state).toBe("retry-wait");
      fx.advance(16_000);
      await fx.dispatcher.runOnce();
      expect(fx.work.snapshot().items.find(value => value.id === item.id)?.state).toBe("completed");
      expect(calls).toBe(2);
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  });

  test("never retries an ambiguous post-submit failure", async () => {
    const fx = fixture(async (_item, hooks) => {
      hooks.onPhase("submit-started");
      throw new Error("network timeout after send");
    });
    try {
      const item = fx.work.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "bob", dedupeKey: "uncertain", priority: 90, maxAttempts: 5 });
      await fx.dispatcher.runOnce();
      const final = fx.work.snapshot().items.find(value => value.id === item.id)!;
      expect(final.state).toBe("uncertain");
      expect(final.attempt).toBe(1);
      expect(fx.health.get("bob")?.state).toBe("quarantined");
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  });
});
