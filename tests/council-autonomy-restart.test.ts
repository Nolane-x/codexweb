import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilAutonomyWorkStore } from "../src/council/autonomy-work-store";

describe("Council autonomy restart recovery", () => {
  test("queued work survives reconstruction and executes at most once by lease", () => {
    const root = mkdtempSync(join(tmpdir(), "council-autonomy-restart-"));
    const path = join(root, "work.json");
    try {
      const first = new CouncilAutonomyWorkStore(path);
      const queued = first.enqueue({ kind: "wake", projectRoomId: "project", targetAgentId: "bob", wakeId: "wake_1", dedupeKey: "wake:project:bob:event:wake_1", priority: 95, correlationDepth: 2 });
      const restarted = new CouncilAutonomyWorkStore(path);
      expect(restarted.snapshot().items.find(item => item.id === queued.id)?.state).toBe("queued");
      expect(restarted.leaseNext("runtime-a")?.id).toBe(queued.id);
      expect(restarted.leaseNext("runtime-b")).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("expired pre-submit lease is retryable but expired post-submit lease becomes uncertain", () => {
    const root = mkdtempSync(join(tmpdir(), "council-autonomy-restart-boundary-"));
    let now = Date.parse("2026-08-15T00:00:00Z");
    const path = join(root, "work.json");
    try {
      const make = () => new CouncilAutonomyWorkStore(path, { now: () => now });
      let store = make();
      const safe = store.enqueue({ kind: "wake", projectRoomId: "project", targetAgentId: "safe", dedupeKey: "safe", priority: 80 });
      store.leaseNext("runtime", 1_000);
      store.markRunning(safe.id, "runtime");
      store.recordPhase(safe.id, "runtime", "connector-selected");
      now += 2_000;
      store = make();
      store.recoverExpiredLeases();
      expect(store.snapshot().items.find(item => item.id === safe.id)?.state).toBe("queued");

      const uncertain = store.enqueue({ kind: "wake", projectRoomId: "project", targetAgentId: "uncertain", dedupeKey: "uncertain", priority: 90 });
      const lease = store.leaseNext("runtime", 1_000)!;
      expect(lease.id).toBe(uncertain.id);
      store.markRunning(uncertain.id, "runtime");
      store.recordPhase(uncertain.id, "runtime", "submit-started");
      now += 2_000;
      store = make();
      store.recoverExpiredLeases();
      const final = store.snapshot().items.find(item => item.id === uncertain.id)!;
      expect(final.state).toBe("uncertain");
      expect(final.failureCode).toBe("SUBMISSION_UNCERTAIN");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
