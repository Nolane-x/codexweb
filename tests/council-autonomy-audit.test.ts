import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilAutonomyAuditStore } from "../src/council/autonomy-audit";

describe("CouncilAutonomyAuditStore", () => {
  test("persists only safe bounded fields and prunes by count", () => {
    const root = mkdtempSync(join(tmpdir(), "council-autonomy-audit-"));
    let now = Date.parse("2026-08-15T00:00:00Z");
    try {
      const path = join(root, "audit.json");
      const audit = new CouncilAutonomyAuditStore(path, { now: () => now, maxEvents: 3, maxAgeMs: 60_000 });
      for (let index = 0; index < 5; index++) {
        audit.append({ correlationId: "corr", workItemId: `work_${index}`, kind: "wake", transition: "created", targetAgentId: "bob", code: "CAPACITY_BUSY", reason: `event ${index}` });
        now += 1;
      }
      expect(audit.list(10).map(event => event.workItemId)).toEqual(["work_2", "work_3", "work_4"]);
      const raw = readFileSync(path, "utf8");
      for (const forbidden of ["conversationUrl", "checkpoint", "token", "prompt", "screenshot", "filesystemPath"]) expect(raw).not.toContain(forbidden);
      expect(new CouncilAutonomyAuditStore(path, { now: () => now, maxEvents: 3, maxAgeMs: 60_000 }).list(10)).toHaveLength(3);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("prunes events older than the configured age", () => {
    const root = mkdtempSync(join(tmpdir(), "council-autonomy-audit-age-"));
    let now = Date.parse("2026-08-15T00:00:00Z");
    try {
      const audit = new CouncilAutonomyAuditStore(join(root, "audit.json"), { now: () => now, maxEvents: 100, maxAgeMs: 1_000 });
      audit.append({ correlationId: "corr", workItemId: "old", kind: "wake", transition: "created" });
      now += 2_000;
      audit.append({ correlationId: "corr", workItemId: "new", kind: "wake", transition: "created" });
      expect(audit.list(10).map(event => event.workItemId)).toEqual(["new"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
