import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilStaleWorkMonitor } from "../src/council/stale-work-monitor";
import { CouncilStore } from "../src/council/store";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "council-stale-"));
  let now = Date.now();
  const council = new CouncilStore(join(root, "state.json"));
  council.joinAgent({ id: "lead", name: "Lead", role: "manager" });
  council.joinAgent({ id: "bob", name: "Bob", role: "coder", status: "sleeping" });
  council.ensureRoom({ id: "project", name: "Project", mission: "Build" });
  const escalations: Array<{ taskId: string; revision: string; status: string }> = [];
  const monitor = new CouncilStaleWorkMonitor({
    council,
    now: () => now,
    managedAgentIds: () => new Set(["bob"]),
    managedStatus: () => "sleeping",
    managerAgentId: () => "lead",
    enqueueEscalation: input => { escalations.push({ taskId: input.taskId, revision: input.taskUpdatedAt, status: input.status }); },
    thresholdsMs: { claimed: 1_000, in_progress: 1_000, review: 1_000, blocked: 1_000 },
  });
  return {
    root,
    council,
    monitor,
    escalations,
    staleAfter: (updatedAt: string, ms = 2_000) => { now = Date.parse(updatedAt) + ms; },
  };
}

describe("CouncilStaleWorkMonitor", () => {
  test("escalates one unchanged stale task revision only once", () => {
    const fx = fixture();
    try {
      const task = fx.council.createTask({ roomId: "project", createdByAgentId: "lead", title: "Implement", description: "Work", assigneeAgentId: "bob" });
      const updated = fx.council.updateTask({ taskId: task.id, actorAgentId: "lead", status: "in_progress", assigneeAgentId: "bob" });
      fx.staleAfter(updated.updatedAt);
      fx.monitor.scan();
      fx.monitor.scan();
      expect(fx.escalations).toHaveLength(1);
      expect(fx.escalations[0]?.taskId).toBe(task.id);
    } finally { fx.monitor.stop(); rmSync(fx.root, { recursive: true, force: true }); }
  });

  test("a genuine task state revision permits one new stale escalation even within the same millisecond", () => {
    const fx = fixture();
    try {
      const task = fx.council.createTask({ roomId: "project", createdByAgentId: "lead", title: "Implement", description: "Work", assigneeAgentId: "bob" });
      const inProgress = fx.council.updateTask({ taskId: task.id, actorAgentId: "lead", status: "in_progress", assigneeAgentId: "bob" });
      fx.staleAfter(inProgress.updatedAt);
      fx.monitor.scan();
      const blocked = fx.council.updateTask({ taskId: task.id, actorAgentId: "bob", status: "blocked" });
      fx.staleAfter(blocked.updatedAt);
      fx.monitor.scan();
      expect(fx.escalations).toHaveLength(2);
      expect(fx.escalations.map(escalation => escalation.status)).toEqual(["in_progress", "blocked"]);
    } finally { fx.monitor.stop(); rmSync(fx.root, { recursive: true, force: true }); }
  });

  test("does not escalate active agents or invent a missing manager", () => {
    const fx = fixture();
    try {
      const task = fx.council.createTask({ roomId: "project", createdByAgentId: "lead", title: "Implement", description: "Work", assigneeAgentId: "bob" });
      const updated = fx.council.updateTask({ taskId: task.id, actorAgentId: "lead", status: "in_progress", assigneeAgentId: "bob" });
      const active = new CouncilStaleWorkMonitor({
        council: fx.council,
        now: () => Date.parse(updated.updatedAt) + 2_000,
        managedAgentIds: () => new Set(["bob"]),
        managedStatus: () => "active",
        managerAgentId: () => "lead",
        enqueueEscalation: () => { fx.escalations.push({ taskId: "bad", revision: "bad", status: "bad" }); },
        thresholdsMs: { claimed: 1, in_progress: 1, review: 1, blocked: 1 },
      });
      active.scan();
      expect(fx.escalations).toHaveLength(0);
      active.stop();
    } finally { fx.monitor.stop(); rmSync(fx.root, { recursive: true, force: true }); }
  });
});
