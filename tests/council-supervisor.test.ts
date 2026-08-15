import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilObservationStore } from "../src/council/observation-store";
import { CouncilSupervisor, COUNCIL_SUPERVISOR_INTERVAL_MS } from "../src/council/supervisor";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("CouncilSupervisor", () => {
  test("captures agents sequentially and calls manager only after capture pass", async () => {
    const root = mkdtempSync(join(tmpdir(), "council-supervisor-"));
    const events: string[] = [];
    let activeCaptures = 0;
    let maxCaptures = 0;
    const agents = [
      { id: "lead", name: "Lead", role: "Manager", mandate: "Lead", permissions: [], conversationUrl: "https://chatgpt.com/c/lead", createdAt: "", updatedAt: "" },
      { id: "critic", name: "Critic", role: "Reviewer", mandate: "Review", permissions: [], conversationUrl: "https://chatgpt.com/c/critic", createdAt: "", updatedAt: "" },
    ];
    const runtime = {
      activeProject: () => ({ roomId: "project", name: "Demo", mission: "Build", leadAgentId: "lead", createdAt: "", updatedAt: "" }),
      supervisorAgents: () => agents,
      publicAgents: () => agents.map(agent => ({ ...agent, conversationBound: true, checkpointSaved: false, runtimeStatus: "sleeping" })),
      schedulerSnapshot: () => ({ active: null, queued: 0, completed: 0, failed: 0 }),
      captureAgent: async (id: string) => {
        activeCaptures += 1;
        maxCaptures = Math.max(maxCaptures, activeCaptures);
        events.push(`${id}:start`);
        await wait(5);
        events.push(`${id}:end`);
        activeCaptures -= 1;
        return { png: Buffer.from(`png-${id}`), conversationUrl: `https://chatgpt.com/c/${id}`, health: "healthy" as const };
      },
      runManagerObservation: async (id: string, _prompt: string, attachments: unknown[]) => {
        events.push(`manager:${id}:${attachments.length}`);
        return "All agents inspected";
      },
    };
    const council = { snapshot: () => ({ tasks: [], wakes: [], messages: [] }) };
    try {
      const observations = new CouncilObservationStore(join(root, "observations"));
      const supervisor = new CouncilSupervisor({ runtime: runtime as any, council: council as any, observations, statePath: join(root, "supervisor.json") });
      supervisor.setManager("lead");
      const run = await supervisor.runNow();
      supervisor.stop();
      expect(maxCaptures).toBe(1);
      expect(events).toEqual(["lead:start", "lead:end", "critic:start", "critic:end", "manager:lead:2"]);
      expect(run.status).toBe("completed");
      expect(run.agents).toHaveLength(2);
      expect(run.managerAnalysis).toContain("inspected");
      expect(observations.list()[0].screenshotCount).toBe(2);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("manager selection enables a 20 minute cadence and clearing it stops future scheduling", () => {
    const root = mkdtempSync(join(tmpdir(), "council-supervisor-"));
    const runtime = {
      activeProject: () => ({ roomId: "project", name: "Demo", mission: "Build", leadAgentId: "lead" }),
      supervisorAgents: () => [{ id: "lead", name: "Lead", role: "Manager", mandate: "Lead", permissions: [], conversationUrl: "https://chatgpt.com/c/lead", createdAt: "", updatedAt: "" }],
      publicAgents: () => [],
      schedulerSnapshot: () => ({ active: null, queued: 0, completed: 0, failed: 0 }),
    };
    try {
      const supervisor = new CouncilSupervisor({ runtime: runtime as any, council: { snapshot: () => ({ tasks: [], wakes: [], messages: [] }) } as any, observations: new CouncilObservationStore(join(root, "observations")), statePath: join(root, "supervisor.json") });
      const enabled = supervisor.setManager("lead");
      expect(enabled.enabled).toBe(true);
      expect(enabled.intervalMs).toBe(COUNCIL_SUPERVISOR_INTERVAL_MS);
      expect(typeof enabled.nextRunAt).toBe("string");
      const disabled = supervisor.setManager(undefined);
      expect(disabled.enabled).toBe(false);
      expect(disabled.managerAgentId).toBeNull();
      expect(disabled.nextRunAt).toBeNull();
      supervisor.stop();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
