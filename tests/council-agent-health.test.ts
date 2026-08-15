import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CouncilAgentHealthLedger } from "../src/council/agent-health";

describe("CouncilAgentHealthLedger", () => {
  test("opens and closes a limited-agent cooldown", () => {
    const root = mkdtempSync(join(tmpdir(), "council-health-"));
    let now = Date.parse("2026-08-15T00:00:00Z");
    try {
      const ledger = new CouncilAgentHealthLedger(join(root, "health.json"), { now: () => now });
      ledger.observeFailure("bob", "CHATGPT_LIMITED", "message limit", "browser");
      expect(ledger.get("bob")?.state).toBe("limited");
      expect(ledger.canAttempt("bob").allowed).toBe(false);
      now += 60 * 60 * 1_000 + 1;
      expect(ledger.canAttempt("bob").allowed).toBe(true);
      ledger.observeSuccess("bob", "dispatcher");
      expect(ledger.get("bob")?.state).toBe("healthy");
      expect(ledger.get("bob")?.consecutiveFailures).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("signed-out and uncertain agents stay blocked until strong/operator evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "council-health-open-"));
    try {
      const ledger = new CouncilAgentHealthLedger(join(root, "health.json"));
      ledger.observeFailure("a", "CHATGPT_SIGNED_OUT", "signed out", "browser");
      ledger.observeFailure("b", "SUBMISSION_UNCERTAIN", "ambiguous submit", "dispatcher");
      expect(ledger.canAttempt("a").allowed).toBe(false);
      expect(ledger.canAttempt("b").allowed).toBe(false);
      expect(ledger.get("b")?.state).toBe("quarantined");

      ledger.observeSupervisor("a", "healthy", "weak supervisor observation");
      ledger.observeSuccess("b", "browser");
      expect(ledger.get("a")?.state).toBe("signed-out");
      expect(ledger.get("b")?.state).toBe("quarantined");
      expect(ledger.canAttempt("b").allowed).toBe(false);

      ledger.clearQuarantine("b", "operator reviewed target conversation");
      expect(ledger.get("b")?.state).toBe("healthy");
      expect(ledger.canAttempt("b").allowed).toBe(true);
      expect(ledger.get("b")?.evidence.at(-1)?.source).toBe("operator");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("connection cooldown grows exponentially and sleeping is not failure", () => {
    const root = mkdtempSync(join(tmpdir(), "council-health-connection-"));
    let now = Date.parse("2026-08-15T00:00:00Z");
    try {
      const ledger = new CouncilAgentHealthLedger(join(root, "health.json"), { now: () => now });
      ledger.observeFailure("bob", "CONNECTION_FAILED", "network", "dispatcher");
      const first = Date.parse(ledger.get("bob")!.cooldownUntil!);
      now += 31_000;
      ledger.observeFailure("bob", "CONNECTION_FAILED", "network", "dispatcher");
      const second = Date.parse(ledger.get("bob")!.cooldownUntil!);
      expect(second - now).toBeGreaterThan(first - Date.parse("2026-08-15T00:00:00Z"));
      const failures = ledger.get("bob")!.consecutiveFailures;
      ledger.observeSleeping("bob", "presence");
      expect(ledger.get("bob")!.consecutiveFailures).toBe(failures);
      expect(ledger.get("bob")!.evidence.length).toBeLessThanOrEqual(20);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("flags repeated healthy/failure oscillation as flapping and persists it", () => {
    const root = mkdtempSync(join(tmpdir(), "council-health-flap-"));
    try {
      const path = join(root, "health.json");
      const ledger = new CouncilAgentHealthLedger(path);
      for (let index = 0; index < 3; index += 1) {
        ledger.observeSuccess("bob", "browser");
        ledger.observeFailure("bob", "CONNECTION_FAILED", "network", "dispatcher");
      }
      expect(ledger.get("bob")?.flapping).toBe(true);
      expect(new CouncilAgentHealthLedger(path).get("bob")?.flapping).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
