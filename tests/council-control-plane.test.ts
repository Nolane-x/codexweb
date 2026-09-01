import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCouncilCapabilityManifest,
  buildCouncilDiagnosticReport,
  buildCouncilSystemStatus,
} from "../src/council/control-plane";

test("capability manifest distinguishes browser fallback from optional connector availability", () => {
  const manifest = buildCouncilCapabilityManifest({
    managedRuntime: true,
    wakeDelivery: true,
    observations: true,
    autonomy: true,
    memory: true,
    execution: true,
  });
  assert.equal(manifest.version, 2);
  assert.equal(manifest.capabilities.browserAutomation, true);
  assert.equal(manifest.capabilities.browserOnlyCouncil, true);
  assert.equal(manifest.capabilities.chatGptConnector.mode, "optional");
  assert.equal(manifest.capabilities.chatGptConnector.requiredForManagedTurns, false);
  assert.equal(manifest.capabilities.autonomy, true);
  assert.equal(manifest.capabilities.execution, true);
});

test("system status contains safe project and health projections without private continuity fields", () => {
  const status = buildCouncilSystemStatus({
    council: { rooms: 1, agents: 3, tasksOpen: 2, activeWakes: 1, decisions: 4 },
    managedProject: { roomId: "core", name: "Alpha", leadAgentId: "lead" },
    managedAgents: [
      { id: "lead", name: "Lead", role: "Coordinator", runtimeStatus: "active", conversationBound: true, checkpointSaved: true },
    ],
    autonomy: { running: true, activeWork: 2, exceptionalWork: 1, breakerOpenCount: 0 },
    memory: { entries: 42, oldestAt: null, newestAt: "2026-08-31T00:00:00.000Z" },
  });
  assert.equal(status.version, 2);
  assert.equal(status.project?.roomId, "core");
  assert.equal(status.managedAgents[0]?.conversationBound, true);
  assert.equal(JSON.stringify(status).includes("conversationUrl"), false);
  assert.equal(JSON.stringify(status).includes('"checkpoint":'), false);
});

test("diagnostics call out connector uncertainty as non-blocking when browser Council is available", () => {
  const report = buildCouncilDiagnosticReport({
    managedRuntime: true,
    wakeDelivery: true,
    autonomyRunning: true,
    activeProject: true,
    managedAgentCount: 2,
    memory: true,
    observations: true,
    execution: true,
  });
  const connector = report.checks.find(check => check.id === "chatgpt-connector");
  assert.equal(connector?.status, "unverified");
  assert.match(connector?.evidence ?? "", /optional/i);
  assert.match(connector?.nextAction ?? "", /browser-only/i);
  const browser = report.checks.find(check => check.id === "browser-control");
  assert.equal(browser?.status, "ready");
  const execution = report.checks.find(check => check.id === "execution-control");
  assert.equal(execution?.status, "ready");
  assert.match(execution?.evidence ?? "", /submission boundary|execution/i);
});
