import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCouncilHttpServer } from "../src/council/http-server";
import { CouncilStore } from "../src/council/store";

const TOKEN = "b".repeat(64);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "council-owner-operator-"));
  const store = new CouncilStore(join(root, "state.json"));
  const calls: string[] = [];
  const server = startCouncilHttpServer(store, {
    port: 0,
    owner: {
      token: () => TOKEN,
      focusAgent: async agentId => ({ agentId, focused: true }),
      startLead: async () => ({}),
      autonomy: {
        status: () => ({ version: 1 }),
        exceptional: () => [{ id: "work_1", state: "uncertain" }],
        cancelExceptional: workItemId => { calls.push(`cancel:${workItemId}`); return { id: workItemId, state: "cancelled" }; },
        retryUncertain: workItemId => { calls.push(`retry:${workItemId}`); return { id: "work_new", source: workItemId }; },
      },
      memory: {
        stats: projectRoomId => ({ entries: projectRoomId ? 2 : 3 }),
        search: input => [{ id: "m1", projectRoomId: input.projectRoomId, text: input.query, limit: input.limit }],
        recent: input => [{ id: "m2", projectRoomId: input.projectRoomId, limit: input.limit }],
        clearProject: projectRoomId => { calls.push(`clear:${projectRoomId}`); return 4; },
      },
    },
  });
  if (!server || typeof server.port !== "number") throw new Error("owner operator HTTP test server failed to start");
  return { root, server, calls, base: `http://127.0.0.1:${server.port}/api/owner` };
}
function cleanup(value: ReturnType<typeof fixture>) { value.server.stop(true); rmSync(value.root, { recursive: true, force: true }); }
async function post(value: ReturnType<typeof fixture>, operation: string, body: unknown = {}, authorization = `Bearer ${TOKEN}`, origin?: string) {
  return await fetch(`${value.base}/${operation}`, { method: "POST", headers: { authorization, "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
}

describe("Council 3.6 owner operator boundary", () => {
  test("allows explicit local operator cancellation and retry but rejects browser origins", async () => {
    const value = fixture();
    try {
      const blocked = await post(value, "autonomy/retry-uncertain", { work_item_id: "work_1" }, `Bearer ${TOKEN}`, "null");
      expect(blocked.status).toBe(403);
      expect(value.calls).toHaveLength(0);

      const retry = await post(value, "autonomy/retry-uncertain", { work_item_id: "work_1" });
      expect(retry.status).toBe(200);
      expect((await retry.json() as any).result).toEqual({ id: "work_new", source: "work_1" });
      const cancel = await post(value, "autonomy/cancel", { work_item_id: "work_2" });
      expect(cancel.status).toBe(200);
      expect(value.calls).toEqual(["retry:work_1", "cancel:work_2"]);
    } finally { cleanup(value); }
  });

  test("memory search is project-scoped and clear is owner-authenticated", async () => {
    const value = fixture();
    try {
      const search = await post(value, "memory/search", { room_id: "project", query: "durable memory", limit: 7 });
      expect(search.status).toBe(200);
      expect((await search.json() as any).result[0]).toMatchObject({ projectRoomId: "project", text: "durable memory", limit: 7 });

      const wrong = await post(value, "memory/clear-project", { room_id: "project" }, "Bearer wrong");
      expect(wrong.status).toBe(401);
      const clear = await post(value, "memory/clear-project", { room_id: "project" });
      expect(clear.status).toBe(200);
      expect((await clear.json() as any).result).toEqual({ deleted: 4 });
      expect(value.calls).toContain("clear:project");
    } finally { cleanup(value); }
  });
});
