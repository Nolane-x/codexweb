import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedProjectStateStore } from "../src/council/managed-project-state";

const workspace = {
  schemaVersion: 1 as const,
  provider: "github" as const,
  repoId: "Nolane-x/codexweb",
  owner: "Nolane-x",
  name: "codexweb",
  defaultBranch: "main",
  baseCommit: "48a596a4fb0caa177ea2967e5c96bbb0c0aec7c3",
};

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

  test("binds only sanitized immutable GitHub repository metadata to the active project", () => {
    const root = mkdtempSync(join(tmpdir(), "managed-project-workspace-"));
    try {
      const path = join(root, "project.json");
      const store = new ManagedProjectStateStore(path);
      const project = store.start({ roomId: "core", name: "Nolane", mission: "Build safely", leadAgentId: "alice" });
      const createdAt = project.createdAt;
      const bindWorkspace = (store as any).bindWorkspace;
      expect(typeof bindWorkspace).toBe("function");

      const bound = bindWorkspace.call(store, workspace);
      expect(bound.workspace).toEqual(workspace);
      expect(bound.createdAt).toBe(createdAt);
      expect(Date.parse(bound.updatedAt)).toBeGreaterThanOrEqual(Date.parse(createdAt));
      expect(new ManagedProjectStateStore(path).get()?.workspace).toEqual(workspace);

      expect(() => bindWorkspace.call(store, { ...workspace, token: "github_pat_must_never_persist" })).toThrow(/workspace|field|metadata/i);
      expect(() => bindWorkspace.call(store, { ...workspace, localPath: "C:\\secret\\checkout" })).toThrow(/workspace|field|metadata/i);
      expect(() => bindWorkspace.call(store, { ...workspace, baseCommit: "main" })).toThrow(/commit/i);
      expect(() => bindWorkspace.call(store, { ...workspace, repoId: "Other/repo" })).toThrow(/repoId|identity/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
