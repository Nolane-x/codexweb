import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateCouncilDecisionGate } from "../src/council/decision-gate";
import { councilWakeCapacity, CouncilStore } from "../src/council/store";
import { normalizeCouncilWakeStatus } from "../src/council/work-operations";

test("legacy wake statuses normalize to the canonical observable lifecycle", () => {
  expect(normalizeCouncilWakeStatus("pending")).toBe("queued");
  expect(normalizeCouncilWakeStatus("delivering")).toBe("target-running");
  expect(normalizeCouncilWakeStatus("acknowledged")).toBe("replied");
  expect(normalizeCouncilWakeStatus("queued")).toBe("queued");
  expect(normalizeCouncilWakeStatus("dispatched")).toBe("dispatched");
  expect(normalizeCouncilWakeStatus("target-running")).toBe("target-running");
  expect(normalizeCouncilWakeStatus("replied")).toBe("replied");
  expect(normalizeCouncilWakeStatus("failed")).toBe("failed");
  expect(normalizeCouncilWakeStatus("expired")).toBe("expired");
});

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

test("canonical runtime transitions are durably ordered and dispatch increments the delivery attempt", () => {
  const root = mkdtempSync(join(tmpdir(), "council-wake-transitions-vnext-"));
  try {
    const store = new CouncilStore(join(root, "state.json"));
    store.joinAgent({ id: "alice", name: "Alice", role: "Architect" });
    store.ensureRoom({ id: "nolane", name: "Nolane", mission: "Review wake lifecycle" });

    const wake = store.wake({ targetAgentId: "alice", roomId: "nolane", reason: "Resume review" });
    store.updateWake(wake.id, "dispatched");
    store.updateWake(wake.id, "target-running");
    const replied = store.updateWake(wake.id, "replied") as any;

    expect(replied.attempts).toBe(1);
    expect(replied.transitions?.map((transition: any) => transition.status)).toEqual([
      "queued",
      "dispatched",
      "target-running",
      "replied",
    ]);
    expect(replied.transitions?.every((transition: any) => Number.isFinite(Date.parse(transition.at)))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("expired wakes are durably reaped once and stop consuming capacity, decision gates and resurrection context", () => {
  const root = mkdtempSync(join(tmpdir(), "council-wake-expiry-vnext-"));
  const statePath = join(root, "state.json");
  try {
    const store = new CouncilStore(statePath);
    store.joinAgent({ id: "alice", name: "Alice", role: "Architect" });
    store.joinAgent({ id: "bob", name: "Bob", role: "Reviewer" });
    store.ensureRoom({ id: "nolane", name: "Nolane", mission: "Review wake lifecycle" });
    store.say({ roomId: "nolane", authorAgentId: "bob", kind: "proposal", body: "Ship after review" });

    const wake = store.wake({ targetAgentId: "alice", roomId: "nolane", reason: "Review before TTL" }) as any;
    const afterExpiry = new Date(Date.parse(wake.expiresAt) + 1).toISOString();

    expect((store as any).expireWakes(afterExpiry)).toBe(1);
    expect((store as any).expireWakes(afterExpiry)).toBe(0);

    const expired = store.snapshot().wakes.find(item => item.id === wake.id) as any;
    expect(expired.status).toBe("expired");
    expect(expired.transitions.map((transition: any) => transition.status)).toEqual(["queued", "expired"]);
    expect(councilWakeCapacity(store.snapshot().wakes, "alice")).toEqual({ active: 0, max: 2, available: 2 });
    expect(evaluateCouncilDecisionGate(store.snapshot(), "nolane").ready).toBe(true);
    expect(store.buildContextPacket({ agentId: "alice", roomId: "nolane" }).wake).toBeUndefined();

    store.wake({ targetAgentId: "alice", roomId: "nolane", reason: "Replacement review A" });
    store.wake({ targetAgentId: "alice", roomId: "nolane", reason: "Replacement review B" });
    expect(councilWakeCapacity(store.snapshot().wakes, "alice")).toEqual({ active: 2, max: 2, available: 0 });

    const restored = new CouncilStore(statePath).snapshot().wakes.find(item => item.id === wake.id) as any;
    expect(restored.status).toBe("expired");
    expect(restored.transitions.filter((transition: any) => transition.status === "expired")).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
