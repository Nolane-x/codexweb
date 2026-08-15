import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilMemoryIndex } from "../src/council/memory-index";

describe("CouncilMemoryIndex", () => {
  test("finds relevant old evidence with provenance and bounded text", () => {
    const root = mkdtempSync(join(tmpdir(), "council-memory-"));
    let now = Date.parse("2026-08-15T00:00:00Z");
    try {
      const memory = new CouncilMemoryIndex(join(root, "memory.json"), { now: () => now });
      memory.upsert({ projectRoomId: "project", sourceType: "manager-analysis", sourceId: "obs1", text: "Bob hit a ChatGPT usage limit while reviewing authentication tests", agentIds: ["bob"] });
      now += 60_000;
      memory.upsert({ projectRoomId: "project", sourceType: "decision", sourceId: "dec1", text: "Use durable queue leasing for wake delivery" });
      const results = memory.search({ projectRoomId: "project", query: "usage limit authentication Bob", limit: 5 });
      expect(results[0]?.sourceId).toBe("obs1");
      expect(results[0]?.text.length).toBeLessThanOrEqual(1200);
      expect(results[0]?.provenance).toEqual({ sourceType: "manager-analysis", sourceId: "obs1" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("deleting a source removes all of its memory entries and persists", () => {
    const root = mkdtempSync(join(tmpdir(), "council-memory-delete-"));
    const path = join(root, "memory.json");
    try {
      let memory = new CouncilMemoryIndex(path);
      memory.upsert({ projectRoomId: "project", sourceType: "observation", sourceId: "obs1", text: "health evidence" });
      memory.upsert({ projectRoomId: "project", sourceType: "observation", sourceId: "obs2", text: "other evidence" });
      expect(memory.deleteSource("observation", "obs1")).toBe(1);
      memory = new CouncilMemoryIndex(path);
      expect(memory.recent({ projectRoomId: "project", limit: 10 }).map(item => item.sourceId)).toEqual(["obs2"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("sanitizes private-looking URLs, paths and secret labels before persistence", () => {
    const root = mkdtempSync(join(tmpdir(), "council-memory-safe-"));
    try {
      const memory = new CouncilMemoryIndex(join(root, "memory.json"));
      memory.upsert({ projectRoomId: "project", sourceType: "audit", sourceId: "a1", text: "conversation https://chatgpt.com/c/private token=abcdef C:\\Users\\me\\secret.txt" });
      const text = JSON.stringify(memory.recent({ projectRoomId: "project", limit: 10 }));
      expect(text).not.toContain("chatgpt.com/c/private");
      expect(text).not.toContain("abcdef");
      expect(text).not.toContain("Users\\me");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
