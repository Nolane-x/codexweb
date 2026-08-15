import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilEvidenceStore } from "../src/council/evidence-store";

describe("CouncilEvidenceStore", () => {
  test("deduplicates identical PNG bytes and preserves references across restart", () => {
    const root = mkdtempSync(join(tmpdir(), "council-evidence-"));
    try {
      const bytes = Buffer.from("fake-png-content");
      let store = new CouncilEvidenceStore(root);
      const first = store.putPng(bytes, "observation:a");
      const second = store.putPng(bytes, "observation:b");
      expect(first.blobId).toBe(second.blobId);
      expect(store.stats()).toMatchObject({ blobs: 1, references: 2, bytes: bytes.length });
      store = new CouncilEvidenceStore(root);
      expect(store.stats().references).toBe(2);
      expect(store.readPng(first.blobId)?.equals(bytes)).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("deleting one reference preserves shared blob and deleting the last collects it", () => {
    const root = mkdtempSync(join(tmpdir(), "council-evidence-ref-"));
    try {
      const store = new CouncilEvidenceStore(root);
      const blob = store.putPng(Buffer.from("shared"), "run:a");
      store.addReference(blob.blobId, "run:b");
      expect(store.removeReference(blob.blobId, "run:a")).toBe(false);
      expect(store.readPng(blob.blobId)).toBeTruthy();
      expect(store.removeReference(blob.blobId, "run:b")).toBe(true);
      expect(store.readPng(blob.blobId)).toBeUndefined();
      expect(existsSync(join(root, "blobs", `${blob.blobId}.png`))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("rejects invalid blob identifiers and keeps storage private", () => {
    const root = mkdtempSync(join(tmpdir(), "council-evidence-safe-"));
    try {
      const store = new CouncilEvidenceStore(root);
      expect(() => store.readPng("../../secret")).toThrow(/blob id/i);
      expect(() => store.addReference("f".repeat(64), "../bad")).toThrow(/reference/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
