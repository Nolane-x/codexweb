import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedProjectStateStore } from "../src/council/managed-project-state";

describe("ManagedProjectStateStore", () => {
  test("persists one active project and permits only the same lead/room to resume it", () => {
    const root = mkdtempSync(join(tmpdir(), "managed-project-"));
    try {
      const path = join(root, "project.json");
      const store = new ManagedProjectStateStore(path);
      store.start({ roomId: "core", name: "Nolane", mission: "Build safely", leadAgentId: "alice" });
      const reopened = new ManagedProjectStateStore(path);
      expect(reopened.get()?.leadAgentId).toBe("alice");
      expect(reopened.start({ roomId: "core", name: "Nolane", mission: "Build better", leadAgentId: "alice" }).mission).toBe("Build better");
      expect(() => reopened.start({ roomId: "other", name: "Other", mission: "Other", leadAgentId: "bob" })).toThrow(/already active/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
