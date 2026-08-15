import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilAutonomyWorkStore } from "../src/council/autonomy-work-store";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "council-autonomy-work-"));
  let now = Date.parse("2026-08-15T00:00:00.000Z");
  const path = join(root, "work.json");
  const make = () => new CouncilAutonomyWorkStore(path, { now: () => now });
  return { root, path, make, advance: (ms: number) => { now += ms; } };
}

describe("CouncilAutonomyWorkStore", () => {
  test("persists work and coalesces active dedupe keys", () => {
    const fx = fixture();
    try {
      const store = fx.make();
      const first = store.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "bob", taskId: "t1", dedupeKey: "wake:r:bob:task:t1", priority: 80, maxAttempts: 4, correlationDepth: 3, reason: "task assigned" });
      const second = store.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "bob", taskId: "t1", dedupeKey: "wake:r:bob:task:t1", priority: 90, maxAttempts: 4, correlationDepth: 4, reason: "still assigned" });
      expect(second.id).toBe(first.id);
      expect(store.snapshot().items).toHaveLength(1);
      expect(store.snapshot().items[0]!.priority).toBe(90);
      expect(store.snapshot().items[0]!.correlationDepth).toBe(3);
      expect(store.snapshot().items[0]!.reasons).toEqual(["task assigned", "still assigned"]);
      expect(fx.make().snapshot().items[0]!.id).toBe(first.id);
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  });

  test("leases highest priority and FIFO within equal priority", () => {
    const fx = fixture();
    try {
      const store = fx.make();
      const low = store.enqueue({ kind: "capture", projectRoomId: "r", targetAgentId: "a", dedupeKey: "low", priority: 10 });
      fx.advance(1);
      const firstHigh = store.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "b", dedupeKey: "high-1", priority: 90 });
      fx.advance(1);
      store.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "c", dedupeKey: "high-2", priority: 90 });
      expect(store.leaseNext("runner")?.id).toBe(firstHigh.id);
      store.complete(firstHigh.id, "runner");
      expect(store.leaseNext("runner")?.dedupeKey).toBe("high-2");
      expect(store.snapshot().items.some(item => item.id === low.id)).toBe(true);
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  });

  test("recovers expired pre-submit lease but quarantines post-submit ambiguity", () => {
    const fx = fixture();
    try {
      const store = fx.make();
      const safe = store.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "a", dedupeKey: "safe", priority: 50 });
      store.leaseNext("runner", 1_000);
      store.markRunning(safe.id, "runner");
      store.recordPhase(safe.id, "runner", "prompt-attached");
      fx.advance(2_000);
      expect(store.recoverExpiredLeases()).toBe(1);
      expect(store.snapshot().items.find(item => item.id === safe.id)?.state).toBe("queued");

      const uncertain = store.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "b", dedupeKey: "uncertain", priority: 60 });
      const leased = store.leaseNext("runner", 1_000)!;
      expect(leased.id).toBe(uncertain.id);
      store.markRunning(uncertain.id, "runner");
      store.recordPhase(uncertain.id, "runner", "submit-started");
      fx.advance(2_000);
      store.recoverExpiredLeases();
      const recovered = store.snapshot().items.find(item => item.id === uncertain.id)!;
      expect(recovered.state).toBe("uncertain");
      expect(recovered.failureCode).toBe("SUBMISSION_UNCERTAIN");
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  });

  test("breaker deferral does not consume a delivery attempt", () => {
    const fx = fixture();
    try {
      const store = fx.make();
      const item = store.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "bob", dedupeKey: "defer", priority: 70 });
      expect(store.leaseNext("runner")?.attempt).toBe(1);
      store.defer(item.id, "runner", { notBefore: "2026-08-15T01:00:00.000Z", code: "CHATGPT_LIMITED", message: "cooldown" });
      const deferred = store.snapshot().items.find(candidate => candidate.id === item.id)!;
      expect(deferred.attempt).toBe(0);
      expect(deferred.state).toBe("retry-wait");
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  });
});
