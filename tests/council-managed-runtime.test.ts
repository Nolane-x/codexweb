import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilAgentRegistry } from "../src/council/agent-registry";
import { CouncilManagedRuntime } from "../src/council/managed-runtime";
import { ManagedAgentStateStore } from "../src/council/managed-agent-state";
import { ManagedProjectStateStore } from "../src/council/managed-project-state";
import { CouncilStore } from "../src/council/store";

const workspace = {
  schemaVersion: 1 as const,
  provider: "github" as const,
  repoId: "Nolane-x/codexweb",
  owner: "Nolane-x",
  name: "codexweb",
  defaultBranch: "main",
  baseCommit: "48a596a4fb0caa177ea2967e5c96bbb0c0aec7c3",
};

function fixture(root: string) {
  const council = new CouncilStore(join(root, "state.json"));
  council.joinAgent({ id: "alice", name: "Alice", role: "Lead" });
  council.joinAgent({ id: "bob", name: "Bob", role: "Critic" });
  return {
    council,
    runtime: new CouncilManagedRuntime({
      council,
      managed: new ManagedAgentStateStore(join(root, "agents.json")),
      project: new ManagedProjectStateStore(join(root, "project.json")),
      registry: new CouncilAgentRegistry(),
      transport: {} as any,
      parseAnswer: (() => { throw new Error("unused"); }) as any,
    }),
  };
}

describe("CouncilManagedRuntime", () => {
  test("only the first authenticated participant can bootstrap the active project lead", () => {
    const root = mkdtempSync(join(tmpdir(), "managed-runtime-"));
    try {
      const { runtime } = fixture(root);
      const started = runtime.startProject("alice", { roomId: "core", name: "Core", mission: "Build safely", mandate: "Lead deliberation" });
      expect(started.lead.permissions).toContain("spawn");
      expect(started.project.leadAgentId).toBe("alice");
      expect(() => runtime.startProject("bob", { roomId: "other", name: "Other", mission: "Hijack", mandate: "Lead" })).toThrow(/already owned/);
      expect(runtime.publicAgents()[0]).toMatchObject({ id: "alice", conversationBound: false, checkpointSaved: false });
      expect((runtime.publicAgents()[0] as any).conversationUrl).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("only the active managed Lead can bind the repository base used for future execution", () => {
    const root = mkdtempSync(join(tmpdir(), "managed-runtime-workspace-"));
    try {
      const { runtime } = fixture(root);
      runtime.startProject("alice", { roomId: "core", name: "Core", mission: "Build safely", mandate: "Lead deliberation" });
      const bindRepoWorkspace = (runtime as any).bindRepoWorkspace;
      expect(typeof bindRepoWorkspace).toBe("function");
      expect(bindRepoWorkspace.call(runtime, "alice", workspace).workspace).toEqual(workspace);
      expect(runtime.activeProject()?.workspace).toEqual(workspace);
      expect(() => bindRepoWorkspace.call(runtime, "bob", workspace)).toThrow(/Lead|lead/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("focuses a bound managed conversation using only controller-owned agent state", async () => {
    const root = mkdtempSync(join(tmpdir(), "managed-runtime-focus-"));
    try {
      const council = new CouncilStore(join(root, "state.json"));
      council.joinAgent({ id: "alice", name: "Alice", role: "Lead" });
      const managed = new ManagedAgentStateStore(join(root, "agents.json"));
      const calls: Array<{ agentId: string; conversationUrl: string }> = [];
      const runtime = new CouncilManagedRuntime({
        council,
        managed,
        project: new ManagedProjectStateStore(join(root, "project.json")),
        registry: new CouncilAgentRegistry(),
        transport: {
          async focusConversation(input: { agentId: string; conversationUrl: string }) { calls.push(input); return { conversationUrl: input.conversationUrl }; },
        } as any,
        parseAnswer: (() => { throw new Error("unused"); }) as any,
      });
      runtime.startProject("alice", { roomId: "core", name: "Core", mission: "Build safely", mandate: "Lead deliberation" });
      managed.bindConversation("alice", "https://chatgpt.com/c/alice");
      await expect(runtime.focusAgentConversation("alice")).resolves.toEqual({ conversationUrl: "https://chatgpt.com/c/alice" });
      expect(calls).toEqual([{ agentId: "alice", conversationUrl: "https://chatgpt.com/c/alice" }]);
      await expect(runtime.focusAgentConversation("missing")).rejects.toThrow(/managed agent does not exist/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

});
