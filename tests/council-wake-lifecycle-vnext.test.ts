import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateCouncilDecisionGate } from "../src/council/decision-gate";
import { councilWakeCapacity, CouncilStore } from "../src/council/store";

test("new wakes begin as an observable queued lifecycle with an expiry boundary", () => {
  const root = mkdtempSync(join(tmpdir(), "council-wake-vnext-"));
  try {
    const store = new CouncilStore(join(root, "state.json"));
    store.joinAgent({ id: "alice", name: "Alice", role: "Architect" });
    store.joinAgent({ id: "bob", name: "Bob", role: "Reviewer" });
    store.ensureRoom({ id: "nolane", name: "Nolane", mission: "Review wake lifecycle" });

    const wake = store.wake({
      targetAgentId: "alice",
      sourceAgentId: "bob",
      roomId: "nolane",
      reason: "Review the current proposal",
    }) as any;

    expect(wake.status).toBe("queued");
    expect(wake.transitions).toEqual([{ status: "queued", at: wake.createdAt }]);
    expect(Date.parse(wake.expiresAt)).toBeGreaterThan(Date.parse(wake.createdAt));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("queued wakes remain active for capacity, decision gating and default resurrection context", () => {
  const root = mkdtempSync(join(tmpdir(), "council-wake-active-vnext-"));
  try {
    const store = new CouncilStore(join(root, "state.json"));
    store.joinAgent({ id: "alice", name: "Alice", role: "Architect" });
    store.joinAgent({ id: "bob", name: "Bob", role: "Reviewer" });
    store.ensureRoom({ id: "nolane", name: "Nolane", mission: "Review wake lifecycle" });
    store.say({ roomId: "nolane", authorAgentId: "bob", kind: "proposal", body: "Ship after review" });

    const first = store.wake({ targetAgentId: "alice", roomId: "nolane", reason: "Review proposal A" });
    expect(councilWakeCapacity(store.snapshot().wakes, "alice")).toEqual({ active: 1, max: 2, available: 1 });

    const context = store.buildContextPacket({ agentId: "alice", roomId: "nolane" });
    expect(context.wake?.id).toBe(first.id);

    const gate = evaluateCouncilDecisionGate(store.snapshot(), "nolane");
    expect(gate.ready).toBe(false);
    expect(gate.reasons.some(reason => reason.includes("wake/review"))).toBe(true);

    store.wake({ targetAgentId: "alice", roomId: "nolane", reason: "Review proposal B" });
    expect(councilWakeCapacity(store.snapshot().wakes, "alice")).toEqual({ active: 2, max: 2, available: 0 });
    expect(() => store.wake({ targetAgentId: "alice", roomId: "nolane", reason: "Review proposal C" })).toThrow(/queue.*full/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
