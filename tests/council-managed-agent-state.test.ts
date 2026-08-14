import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedAgentStateStore } from "../src/council/managed-agent-state";

describe("ManagedAgentStateStore", () => {
  test("persists identity, mandate, conversation and permissions without a runtime surface lease", () => {
    const root = mkdtempSync(join(tmpdir(), "managed-agent-"));
    const path = join(root, "agents.json");
    try {
      const store = new ManagedAgentStateStore(path);
      store.upsert({ id: "alice", name: "Alice", role: "Architect", mandate: "Design", permissions: ["spawn", "finalize"] });
      store.bindConversation("alice", "https://chatgpt.com/c/abc");
      const reopened = new ManagedAgentStateStore(path);
      expect(reopened.get("alice")?.conversationUrl).toBe("https://chatgpt.com/c/abc");
      expect(reopened.get("alice")?.permissions).toEqual(["spawn", "finalize"]);
      expect((reopened.get("alice") as { surfaceId?: string })?.surfaceId).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
