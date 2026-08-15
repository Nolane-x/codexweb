import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilAutonomyRouter } from "../src/council/autonomy-router";
import { CouncilAutonomyWorkStore } from "../src/council/autonomy-work-store";
import { CouncilStore } from "../src/council/store";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "council-router-"));
  const council = new CouncilStore(join(root, "state.json"));
  const work = new CouncilAutonomyWorkStore(join(root, "work.json"));
  council.joinAgent({ id: "lead", name: "Lead", role: "lead" });
  council.joinAgent({ id: "bob", name: "Bob", role: "coder", status: "sleeping" });
  council.joinAgent({ id: "reviewer", name: "Reviewer", role: "reviewer", status: "sleeping" });
  council.ensureRoom({ id: "project", name: "Project", mission: "Build" });
  const status = new Map<string, "active" | "sleeping" | "queued" | "failed">([["bob", "sleeping"], ["reviewer", "sleeping"]]);
  const router = new CouncilAutonomyRouter({
    council,
    work,
    managedAgentIds: () => new Set(["bob", "reviewer"]),
    managedStatus: id => status.get(id),
  });
  return { root, council, work, router, status };
}

describe("CouncilAutonomyRouter", () => {
  test("routes an assigned task exactly once to a sleeping managed agent", () => {
    const fx = fixture();
    try {
      const task = fx.council.createTask({ roomId: "project", createdByAgentId: "lead", title: "Implement", description: "Do it", assigneeAgentId: "bob" });
      fx.router.scan();
      fx.router.scan();
      const routed = fx.work.snapshot().items.filter(item => item.taskId === task.id);
      expect(routed).toHaveLength(1);
      expect(routed[0]!.kind).toBe("task-route");
      expect(routed[0]!.targetAgentId).toBe("bob");
      expect(routed[0]!.wakeId).toBeString();
    } finally { fx.router.stop(); rmSync(fx.root, { recursive: true, force: true }); }
  });

  test("routes review and explicit mentions but not sleeping without actionable work", () => {
    const fx = fixture();
    try {
      fx.router.scan();
      expect(fx.work.snapshot().items).toHaveLength(0);
      const task = fx.council.createTask({ roomId: "project", createdByAgentId: "lead", title: "Review", description: "Review it", assigneeAgentId: "reviewer" });
      fx.council.updateTask({ taskId: task.id, actorAgentId: "lead", status: "review", assigneeAgentId: "reviewer" });
      fx.council.say({ roomId: "project", authorAgentId: "lead", body: "Bob please inspect the failure", mentions: ["bob"] });
      fx.router.scan();
      const items = fx.work.snapshot().items;
      expect(items.some(item => item.kind === "review-route" && item.targetAgentId === "reviewer")).toBe(true);
      expect(items.some(item => item.kind === "wake" && item.targetAgentId === "bob")).toBe(true);
    } finally { fx.router.stop(); rmSync(fx.root, { recursive: true, force: true }); }
  });

  test("does not auto-route a task to an already active managed agent", () => {
    const fx = fixture();
    try {
      fx.status.set("bob", "active");
      fx.council.createTask({ roomId: "project", createdByAgentId: "lead", title: "Implement", description: "Do it", assigneeAgentId: "bob" });
      fx.router.scan();
      expect(fx.work.snapshot().items).toHaveLength(0);
    } finally { fx.router.stop(); rmSync(fx.root, { recursive: true, force: true }); }
  });
});
