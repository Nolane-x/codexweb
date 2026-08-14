import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilStore } from "../src/council/store";

test("new wakes begin as an observable queued lifecycle with an expiry boundary", () => {
  const root = mkdtempSync(join(tmpdir(), "council-wake-vnext-"));
  try {
    const store = new CouncilStore(join(root, "state.json"));
    store.joinAgent({ id: "alice", name: "Alice", role: "Architect" });
    store.joinAgent({ id: "bob", name: "Bob", role: "Reviewer" });
    store.ensureRoom({ id: "nolane", name: "Nolane", mission: "Review wake lifecycle" });

    const wake = store.wake({
      targetAgentId: "alice",
      sourceAgentId: "bob",
      roomId: "nolane",
      reason: "Review the current proposal",
    }) as any;

    expect(wake.status).toBe("queued");
    expect(wake.transitions).toEqual([{ status: "queued", at: wake.createdAt }]);
    expect(Date.parse(wake.expiresAt)).toBeGreaterThan(Date.parse(wake.createdAt));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
