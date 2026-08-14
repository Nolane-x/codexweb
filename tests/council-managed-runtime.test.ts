import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilAgentRegistry } from "../src/council/agent-registry";
import { CouncilManagedRuntime } from "../src/council/managed-runtime";
import { ManagedAgentStateStore } from "../src/council/managed-agent-state";
import { ManagedProjectStateStore } from "../src/council/managed-project-state";
import { CouncilStore } from "../src/council/store";

describe("CouncilManagedRuntime", () => {
  test("only the first authenticated participant can bootstrap the active project lead", () => {
    const root = mkdtempSync(join(tmpdir(), "managed-runtime-"));
    try {
      const council = new CouncilStore(join(root, "state.json"));
      council.joinAgent({ id: "alice", name: "Alice", role: "Lead" });
      council.joinAgent({ id: "bob", name: "Bob", role: "Critic" });
      const runtime = new CouncilManagedRuntime({
        council,
        managed: new ManagedAgentStateStore(join(root, "agents.json")),
        project: new ManagedProjectStateStore(join(root, "project.json")),
        registry: new CouncilAgentRegistry(),
        transport: {} as any,
        parseAnswer: (() => { throw new Error("unused"); }) as any,
      });
      const started = runtime.startProject("alice", { roomId: "core", name: "Core", mission: "Build safely", mandate: "Lead deliberation" });
      expect(started.lead.permissions).toContain("spawn");
      expect(started.project.leadAgentId).toBe("alice");
      expect(() => runtime.startProject("bob", { roomId: "other", name: "Other", mission: "Hijack", mandate: "Lead" })).toThrow(/already owned/);
      expect(runtime.publicAgents()[0]).toMatchObject({ id: "alice", conversationBound: false, checkpointSaved: false });
      expect((runtime.publicAgents()[0] as any).conversationUrl).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
