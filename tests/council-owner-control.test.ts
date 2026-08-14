import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueCouncilOwnerControl, ownerBearerMatches } from "../src/council/owner-control";

describe("Council owner control", () => {
  test("issues a private random loopback capability and authenticates in constant-time form", () => {
    const root = mkdtempSync(join(tmpdir(), "council-owner-"));
    try {
      const path = join(root, "owner-control.json");
      const descriptor = issueCouncilOwnerControl(path, 17842);
      expect(descriptor.endpoint).toBe("http://127.0.0.1:17842/api/owner");
      expect(descriptor.token.length).toBeGreaterThanOrEqual(43);
      expect(ownerBearerMatches(descriptor.token, `Bearer ${descriptor.token}`)).toBe(true);
      expect(ownerBearerMatches(descriptor.token, `Bearer ${"x".repeat(descriptor.token.length)}`)).toBe(false);
      expect(JSON.parse(readFileSync(path, "utf8")).token).toBe(descriptor.token);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
