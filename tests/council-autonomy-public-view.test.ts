import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilAutonomyKernel } from "../src/council/autonomy-kernel";
import { CouncilStore } from "../src/council/store";

describe("Council autonomy public view", () => {
  test("exposes queue/health/budget summaries without private continuity fields", () => {
    const root = mkdtempSync(join(tmpdir(), "council-autonomy-public-"));
    try {
      const council = new CouncilStore(join(root, "state.json"));
      const runtime = {
        activeProject: () => ({ roomId: "project", name: "Project", mission: "Build", leadAgentId: "lead" }),
        supervisorAgents: () => [{ id: "lead", name: "Lead", role: "Manager", conversationUrl: "https://chatgpt.com/c/private", checkpoint: "private memory" }],
        managedStatus: () => "sleeping",
        attachAutonomy: () => {},
      };
      const supervisor = {
        attachAutonomy: () => {},
        status: () => ({ managerAgentId: "lead" }),
      };
      const kernel = new CouncilAutonomyKernel({ rootDir: root, council, runtime: runtime as any, supervisor: supervisor as any });
      kernel.health.observeFailure("lead", "CHATGPT_LIMITED", "usage limit", "dispatcher");
      kernel.work.enqueue({ kind: "wake", projectRoomId: "project", targetAgentId: "lead", dedupeKey: "wake", priority: 90 });
      const text = JSON.stringify(kernel.status());
      expect(text).toContain("CHATGPT_LIMITED");
      for (const forbidden of ["chatgpt.com/c/private", "private memory", "conversationUrl", "checkpoint", "agent_token", "owner-control", "screenshotId"]) expect(text).not.toContain(forbidden);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
