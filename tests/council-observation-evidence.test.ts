import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilEvidenceStore } from "../src/council/evidence-store";
import { CouncilObservationStore } from "../src/council/observation-store";

describe("CouncilObservationStore evidence integration", () => {
  test("deduplicates identical screenshots across observation runs and garbage-collects the last reference", () => {
    const root = mkdtempSync(join(tmpdir(), "council-observation-evidence-"));
    try {
      const evidence = new CouncilEvidenceStore(join(root, "evidence"));
      const observations = new CouncilObservationStore(join(root, "observations"), { evidence });
      const bytes = Buffer.from("same-screenshot");
      const first = observations.begin({ projectRoomId: "project", managerAgentId: "lead" });
      const firstAgent = observations.addAgent(first.id, { agentId: "a", name: "A", role: "coder", capturedAt: new Date().toISOString(), health: "healthy" }, bytes);
      observations.complete(first.id);
      const second = observations.begin({ projectRoomId: "project", managerAgentId: "lead" });
      const secondAgent = observations.addAgent(second.id, { agentId: "b", name: "B", role: "reviewer", capturedAt: new Date().toISOString(), health: "sleeping" }, bytes);
      observations.complete(second.id);

      expect(observations.evidenceStats()).toMatchObject({ blobs: 1, references: 2, bytes: bytes.length });
      expect(observations.readScreenshot(first.id, firstAgent.screenshotId!)?.equals(bytes)).toBe(true);
      expect(observations.readScreenshot(second.id, secondAgent.screenshotId!)?.equals(bytes)).toBe(true);

      expect(observations.delete(first.id)).toBe(true);
      expect(observations.evidenceStats()).toMatchObject({ blobs: 1, references: 1 });
      expect(observations.readScreenshot(second.id, secondAgent.screenshotId!)?.equals(bytes)).toBe(true);

      expect(observations.delete(second.id)).toBe(true);
      expect(observations.evidenceStats()).toMatchObject({ blobs: 0, references: 0, bytes: 0 });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("lazily imports a Council 3.5 per-run screenshot into the evidence store", () => {
    const root = mkdtempSync(join(tmpdir(), "council-observation-migrate-"));
    try {
      const observationRoot = join(root, "observations");
      const legacy = new CouncilObservationStore(observationRoot);
      const run = legacy.begin({ projectRoomId: "project", managerAgentId: "lead" });
      const bytes = Buffer.from("legacy-screenshot");
      const agent = legacy.addAgent(run.id, { agentId: "a", name: "A", role: "coder", capturedAt: new Date().toISOString(), health: "healthy" }, bytes);
      legacy.complete(run.id);
      const legacyPath = join(observationRoot, "screenshots", run.id, agent.screenshotId!);
      expect(existsSync(legacyPath)).toBe(true);

      const evidence = new CouncilEvidenceStore(join(root, "evidence"));
      const migrated = new CouncilObservationStore(observationRoot, { evidence });
      expect(migrated.readScreenshot(run.id, agent.screenshotId!)?.equals(bytes)).toBe(true);
      expect(existsSync(legacyPath)).toBe(false);
      expect(migrated.evidenceStats()).toMatchObject({ blobs: 1, references: 1 });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("prunes oldest observation evidence when the combined archive exceeds the byte budget", () => {
    const root = mkdtempSync(join(tmpdir(), "council-observation-budget-"));
    try {
      const evidence = new CouncilEvidenceStore(join(root, "evidence"));
      const observations = new CouncilObservationStore(join(root, "observations"), { evidence, maxBytes: 1024 * 1024 });
      const firstBytes = Buffer.alloc(700 * 1024, 1);
      const secondBytes = Buffer.alloc(700 * 1024, 2);
      const first = observations.begin({ projectRoomId: "project", managerAgentId: "lead", startedAt: "2026-08-15T00:00:00.000Z" });
      observations.addAgent(first.id, { agentId: "a", name: "A", role: "coder", capturedAt: "2026-08-15T00:00:00.000Z", health: "healthy" }, firstBytes);
      observations.complete(first.id, { completedAt: "2026-08-15T00:00:01.000Z" });
      const second = observations.begin({ projectRoomId: "project", managerAgentId: "lead", startedAt: "2026-08-15T00:01:00.000Z" });
      observations.addAgent(second.id, { agentId: "b", name: "B", role: "reviewer", capturedAt: "2026-08-15T00:01:00.000Z", health: "healthy" }, secondBytes);
      observations.complete(second.id, { completedAt: "2026-08-15T00:01:01.000Z" });

      expect(observations.get(first.id)).toBeUndefined();
      expect(observations.get(second.id)?.id).toBe(second.id);
      expect(observations.evidenceStats()).toMatchObject({ blobs: 1, references: 1, bytes: secondBytes.length });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
