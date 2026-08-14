import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCouncilHttpServer } from "../src/council/http-server";
import { CouncilStore } from "../src/council/store";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "council-http-sync-"));
  const store = new CouncilStore(join(root, "state.json"));
  const server = startCouncilHttpServer(store, { port: 0 });
  if (!server || typeof server.port !== "number") throw new Error("Council sync test server failed to start");
  return { root, store, server, base: `http://127.0.0.1:${server.port}` };
}

function cleanup(value: ReturnType<typeof fixture>) {
  value.server.stop(true);
  rmSync(value.root, { recursive: true, force: true });
}

describe("Council canonical sync contract", () => {
  test("publishes an atomic public snapshot with an opaque continuation cursor", async () => {
    const value = fixture();
    try {
      value.store.joinAgent({ id: "alice", name: "Alice", role: "Architect" });
      value.store.ensureRoom({ id: "project", name: "Project", mission: "Ship vNext" });
      value.store.say({ roomId: "project", authorAgentId: "alice", body: "Canonical state is live" });

      const response = await fetch(`${value.base}/api/sync/snapshot`);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.schemaVersion).toBe(1);
      expect(typeof body.cursor).toBe("string");
      expect(body.cursor.length).toBeGreaterThan(12);
      expect(body.state.rooms.map((room: any) => room.id)).toEqual(["project"]);
      expect(body.state.agents.map((agent: any) => agent.id)).toEqual(["alice"]);
      expect(body.state.messages.at(-1)?.body).toBe("Canonical state is live");
      expect("checkpoints" in body.state).toBe(false);
    } finally { cleanup(value); }
  });

  test("changes the opaque cursor when canonical Council state mutates", async () => {
    const value = fixture();
    try {
      const first = await fetch(`${value.base}/api/sync/snapshot`);
      expect(first.status).toBe(200);
      const before = await first.json() as any;

      value.store.joinAgent({ id: "alice", name: "Alice", role: "Architect" });

      const second = await fetch(`${value.base}/api/sync/snapshot`);
      expect(second.status).toBe(200);
      const after = await second.json() as any;
      expect(after.cursor).not.toBe(before.cursor);
      expect(after.state.agents.map((agent: any) => agent.id)).toEqual(["alice"]);
    } finally { cleanup(value); }
  });

  test("rejects an invalid or foreign continuation cursor with typed RESYNC_REQUIRED", async () => {
    const value = fixture();
    try {
      const response = await fetch(`${value.base}/api/sync/next?after=foreign-cursor&wait_ms=1`);
      expect(response.status).toBe(409);
      const body = await response.json() as any;
      expect(body).toEqual({
        schemaVersion: 1,
        type: "resync-required",
        reason: { code: "RESYNC_REQUIRED" },
      });
    } finally { cleanup(value); }
  });
});
