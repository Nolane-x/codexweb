import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerCouncilDiscussionTools } from "../src/council/mcp-tools-discussion";
import { CouncilStore } from "../src/council/store";

type ToolHandler = (input: any, extra: unknown) => Promise<any> | any;

function captureDiscussionTools(store: CouncilStore): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  };
  registerCouncilDiscussionTools(server as any, store, (_extra, explicit) => explicit!);
  return handlers;
}

describe("Council status wake capacity", () => {
  test("reports delivering wakes as active when the same wakes fill the target queue", async () => {
    const root = mkdtempSync(join(tmpdir(), "council-status-capacity-"));
    try {
      const store = new CouncilStore(join(root, "state.json"));
      store.joinAgent({ id: "alice", name: "Alice", role: "Reviewer" });
      store.ensureRoom({ id: "project", name: "Project", mission: "Ship safely" });

      const first = store.wake({ targetAgentId: "alice", roomId: "project", reason: "First review" });
      const second = store.wake({ targetAgentId: "alice", roomId: "project", reason: "Second review" });
      store.updateWake(first.id, "delivering");
      store.updateWake(second.id, "delivering");

      expect(() => store.wake({ targetAgentId: "alice", roomId: "project", reason: "Third review" })).toThrow("Wake queue for alice is full");

      const status = captureDiscussionTools(store).get("council_status");
      expect(status).toBeDefined();
      const result = await status!({ agent_id: "alice", agent_token: "A".repeat(43), room_id: "project" }, {});
      const view = result.structuredContent as any;

      expect(view.pending_wakes).toHaveLength(0);
      expect(view.active_wakes.map((wake: any) => wake.status)).toEqual(["delivering", "delivering"]);
      expect(view.wake_capacity).toEqual({ active: 2, max: 2, available: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
