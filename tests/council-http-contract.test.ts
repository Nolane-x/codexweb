import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCouncilPublicSnapshot, COUNCIL_HTTP_DEFAULT_PORT, COUNCIL_HTTP_HOST } from "../src/council/http-server";
import { CouncilStore } from "../src/council/store";

describe("Council dashboard contract", () => {
  test("publishes a bounded loopback-only view without private checkpoints", () => {
    const root = mkdtempSync(join(tmpdir(), "council-http-"));
    try {
      const store = new CouncilStore(join(root, "state.json"));
      store.joinAgent({ id: "alice", name: "Alice", role: "Architect" });
      store.ensureRoom({ id: "nolane", name: "Nolane", mission: "Reach policy" });
      store.checkpoint({ agentId: "alice", roomId: "nolane", summary: "private continuity state" });
      store.say({ roomId: "nolane", authorAgentId: "alice", body: "Visible Council message" });
      const snapshot = buildCouncilPublicSnapshot(store);
      expect(snapshot.messages.at(-1)?.body).toBe("Visible Council message");
      expect("checkpoints" in snapshot).toBe(false);
      expect(COUNCIL_HTTP_HOST).toBe("127.0.0.1");
      expect(COUNCIL_HTTP_DEFAULT_PORT).toBe(17_842);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
