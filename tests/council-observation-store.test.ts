import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilObservationStore } from "../src/council/observation-store";

function tempStore(options: { maxRuns?: number; maxBytes?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), "council-observations-"));
  return { root, store: new CouncilObservationStore(root, options) };
}

describe("CouncilObservationStore", () => {
  test("archives screenshots and exposes only opaque screenshot ids", () => {
    const { root, store } = tempStore();
    try {
      const run = store.begin({ projectRoomId: "project", managerAgentId: "lead" });
      const observed = store.addAgent(run.id, {
        agentId: "critic",
        name: "Critic",
        role: "Reviewer",
        capturedAt: new Date().toISOString(),
        health: "healthy",
      }, Buffer.from([137, 80, 78, 71]));
      expect(observed.screenshotId).toMatch(/\.png$/);
      expect(observed.screenshotId).not.toContain(root);
      expect(store.readScreenshot(run.id, observed.screenshotId!)).toEqual(Buffer.from([137, 80, 78, 71]));
      const completed = store.complete(run.id, { managerAnalysis: "Critic is healthy" });
      expect(completed.status).toBe("completed");
      expect(store.list()[0].screenshotCount).toBe(1);
      expect(store.memoryDigest()).toContain("Critic is healthy");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("deleting a run removes its image directory and clear removes all history", () => {
    const { root, store } = tempStore();
    try {
      const first = store.begin({ projectRoomId: "project", managerAgentId: "lead" });
      const image = store.addAgent(first.id, { agentId: "one", name: "One", role: "Worker", capturedAt: new Date().toISOString(), health: "sleeping" }, Buffer.from("image"));
      store.complete(first.id);
      const imagePath = join(root, "screenshots", first.id, image.screenshotId!);
      expect(existsSync(imagePath)).toBe(true);
      expect(store.delete(first.id)).toBe(true);
      expect(existsSync(imagePath)).toBe(false);
      const second = store.begin({ projectRoomId: "project", managerAgentId: "lead" });
      store.fail(second.id, "network");
      expect(store.clear()).toBe(1);
      expect(store.list()).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("prunes oldest runs and recovers from corrupt metadata", () => {
    const { root, store } = tempStore({ maxRuns: 2 });
    try {
      for (let index = 0; index < 3; index++) {
        const run = store.begin({ projectRoomId: "project", managerAgentId: "lead", startedAt: `2026-08-15T00:0${index}:00.000Z` });
        store.complete(run.id, { completedAt: `2026-08-15T00:0${index}:01.000Z` });
      }
      expect(store.list()).toHaveLength(2);
      expect(store.list().some(run => run.startedAt.includes("00:00:00"))).toBe(false);
      const indexPath = join(root, "index.json");
      expect(JSON.parse(readFileSync(indexPath, "utf8")).runs).toHaveLength(2);
    } finally { rmSync(root, { recursive: true, force: true }); }

    const corruptRoot = mkdtempSync(join(tmpdir(), "council-observations-corrupt-"));
    try {
      writeFileSync(join(corruptRoot, "index.json"), "{not-json", "utf8");
      const recovered = new CouncilObservationStore(corruptRoot);
      expect(recovered.list()).toEqual([]);
    } finally { rmSync(corruptRoot, { recursive: true, force: true }); }
  });
});
