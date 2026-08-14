import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertAgentTokenNotExposed } from "../src/council/mcp-shared";
import { CouncilStore } from "../src/council/store";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "council-security-"));
  const store = new CouncilStore(join(root, "state.json"));
  const alice = store.joinAgent({ id: "alice", name: "Alice", role: "Architect" });
  const bob = store.joinAgent({ id: "bob", name: "Bob", role: "Critic" });
  store.ensureRoom({ id: "room", name: "Room", mission: "Test security boundaries" });
  return { root, store, alice, bob };
}

describe("Council security boundaries", () => {
  test("requires possession of the per-agent capability", () => {
    const { root, store, alice } = fixture();
    try {
      expect(() => store.authenticateAgent("alice", "A".repeat(43))).toThrow();
      expect(store.authenticateAgent("alice", alice.agentToken).id).toBe("alice");
      expect(() => store.joinAgent({ id: "alice", name: "Mallory", role: "Impostor" }, "B".repeat(43))).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("fails closed for pre-capability identities instead of allowing first-caller takeover", () => {
    const root = mkdtempSync(join(tmpdir(), "council-legacy-"));
    const statePath = join(root, "state.json");
    try {
      writeFileSync(statePath, JSON.stringify({ version: 1, agents: [{ id: "alice", name: "Alice", role: "Architect", status: "sleeping", joinedAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" }], rooms: [], messages: [], decisions: [], tasks: [], wakes: [], checkpoints: [] }));
      const store = new CouncilStore(statePath);
      expect(() => store.joinAgent({ id: "alice", name: "Mallory", role: "Impostor" })).toThrow(/locked/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("rate-limits repeated source-to-target wakes", () => {
    const { root, store } = fixture();
    try {
      store.wake({ targetAgentId: "alice", sourceAgentId: "bob", roomId: "room", reason: "First wake" });
      expect(() => store.wake({ targetAgentId: "alice", sourceAgentId: "bob", roomId: "room", reason: "Spam wake" })).toThrow(/cooldown/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("keeps credentials private from ordinary agent records", () => {
    const { root, store, alice } = fixture();
    try {
      const publicAgent = store.authenticateAgent("alice", alice.agentToken) as unknown as Record<string, unknown>;
      expect(publicAgent.agentToken).toBeUndefined();
      expect(publicAgent.token).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("rejects Council content that would disclose the caller capability", () => {
    const token = "A".repeat(43);
    expect(() => assertAgentTokenNotExposed(token, ["safe text", { nested: `leak:${token}` }])).toThrow(/expose/i);
    expect(() => assertAgentTokenNotExposed(token, ["safe text"])).not.toThrow();
  });
});
