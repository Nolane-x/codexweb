import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCouncilPublicSnapshot } from "../src/council/http-server";
import { registerCouncilDiscussionTools } from "../src/council/mcp-tools-discussion";
import { CouncilStore } from "../src/council/store";

type ToolHandler = (input: any, extra: unknown) => Promise<any> | any;

function captureDiscussionTools(store: CouncilStore): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: ToolHandler) { handlers.set(name, handler); },
  };
  registerCouncilDiscussionTools(server as any, store, (_extra, explicit) => explicit!);
  return handlers;
}

describe("Council presence lease", () => {
  test("keeps explicit awake status while ephemeral presence transitions fresh to stale and restart to unknown", () => {
    const root = mkdtempSync(join(tmpdir(), "council-presence-"));
    try {
      const path = join(root, "state.json");
      const store = new CouncilStore(path);
      store.joinAgent({ id: "alice", name: "Alice", role: "Reviewer", status: "awake" });

      const touch = (store as any).touchAgentPresence;
      const snapshotPresence = (store as any).presenceSnapshot;
      expect(typeof touch).toBe("function");
      expect(typeof snapshotPresence).toBe("function");

      const seenAt = "2026-08-14T12:00:00.000Z";
      touch.call(store, "alice", seenAt);
      expect(snapshotPresence.call(store, "2026-08-14T12:00:30.000Z")).toEqual([{
        agentId: "alice",
        lastSeenAt: seenAt,
        leaseExpiresAt: "2026-08-14T12:01:00.000Z",
        freshness: "fresh",
      }]);
      expect(snapshotPresence.call(store, "2026-08-14T12:01:01.000Z")[0].freshness).toBe("stale");
      expect(store.snapshot().agents[0]?.status).toBe("awake");

      const restarted = new CouncilStore(path);
      expect((restarted as any).presenceSnapshot("2026-08-14T12:01:01.000Z")).toEqual([{ agentId: "alice", freshness: "unknown" }]);
      expect(restarted.snapshot().agents[0]?.status).toBe("awake");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("coalesces authenticated activity revisions until the published lease enters its renewal window", () => {
    const root = mkdtempSync(join(tmpdir(), "council-presence-revision-"));
    try {
      const store = new CouncilStore(join(root, "state.json"));
      store.joinAgent({ id: "alice", name: "Alice", role: "Reviewer" });
      const touch = (store as any).touchAgentPresence;
      expect(typeof touch).toBe("function");

      touch.call(store, "alice", "2027-01-01T00:00:00.000Z");
      const firstPublished = store.currentRevision();
      touch.call(store, "alice", "2027-01-01T00:00:05.000Z");
      touch.call(store, "alice", "2027-01-01T00:00:20.000Z");
      expect(store.currentRevision()).toBe(firstPublished);

      touch.call(store, "alice", "2027-01-01T00:00:45.000Z");
      expect(store.currentRevision()).toBe(firstPublished + 1);
      const renewed = store.currentRevision();
      touch.call(store, "alice", "2027-01-01T00:01:46.000Z");
      expect(store.currentRevision()).toBe(renewed + 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("publishes presence separately in HTTP and council_status without exposing private credentials", async () => {
    const root = mkdtempSync(join(tmpdir(), "council-presence-public-"));
    try {
      const store = new CouncilStore(join(root, "state.json"));
      const joined = store.joinAgent({ id: "alice", name: "Alice", role: "Reviewer" });
      const touch = (store as any).touchAgentPresence;
      touch.call(store, "alice", "2026-08-14T12:00:00.000Z");

      const publicSnapshot = buildCouncilPublicSnapshot(store) as any;
      expect(publicSnapshot.presence[0]).toMatchObject({ agentId: "alice", lastSeenAt: "2026-08-14T12:00:00.000Z" });
      expect(JSON.stringify(publicSnapshot.presence)).not.toContain(joined.agentToken);

      const status = captureDiscussionTools(store).get("council_status");
      expect(status).toBeDefined();
      const result = await status!({ agent_id: "alice", agent_token: joined.agentToken }, {});
      expect(result.structuredContent.presence[0]).toMatchObject({ agentId: "alice" });
      expect(JSON.stringify(result.structuredContent.presence)).not.toContain(joined.agentToken);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
