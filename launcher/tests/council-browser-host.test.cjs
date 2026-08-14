const test = require("node:test");
const assert = require("node:assert/strict");
const { createCouncilBrowserHostClass } = require("../electron/council-browser-host.cjs");

class FakeLegacyBrowserHost {
  constructor() {
    this.turnTabs = new Map();
    this.selectedTabId = "home";
    this.logger = { info() {}, warn() {} };
  }
  beginTurn(traceId, _reveal, helperPid) {
    const tab = { id: `tab-${this.turnTabs.size + 1}`, surfaceId: `surface-${this.turnTabs.size + 1}`, traceId, helperPid, status: "running", loading: true, message: "ChatGPT is working", lastHeartbeatAt: Date.now(), bootstrapReady: true, view: { webContents: { isDestroyed: () => false, setBackgroundThrottling() {} } } };
    this.turnTabs.set(tab.id, tab);
    this.selectedTabId = tab.id;
    return { surfaceId: tab.surfaceId, tabId: tab.id };
  }
  async endTurn(traceId) { const tab = [...this.turnTabs.values()].find(candidate => candidate.traceId === traceId); if (tab) this.removeTurnTab(tab, false); }
  removeTurnTab(tab) { this.turnTabs.delete(tab.id); }
  syncViewVisibility() {}
  snapshot() { return { tabs: [...this.turnTabs.keys()] }; }
  writeDescriptor() {}
  hide() {}
}

const CouncilHost = createCouncilBrowserHostClass(FakeLegacyBrowserHost);

test("persistent binding reuses the same surface across different trace ids", async () => {
  const host = new CouncilHost();
  const first = host.beginTurn("trace_1", false, 10, "agent:alice");
  await host.endTurn("trace_1", 10, "completed", false);
  assert.equal(host.turnTabs.size, 1);
  const second = host.beginTurn("trace_2", false, 11, "agent:alice");
  assert.equal(second.surfaceId, first.surfaceId);
  assert.equal(second.tabId, first.tabId);
  assert.equal(host.turnTabs.size, 1);
});

test("legacy unbound turn still releases at end", async () => {
  const host = new CouncilHost();
  host.beginTurn("trace_legacy", false, 10);
  await host.endTurn("trace_legacy", 10, "completed", false);
  assert.equal(host.turnTabs.size, 0);
});

test("closing a persistent tab releases its binding", () => {
  const host = new CouncilHost();
  host.beginTurn("trace_1", false, 10, "agent:alice");
  const tab = [...host.turnTabs.values()][0];
  host.removeTurnTab(tab, true);
  const next = host.beginTurn("trace_2", false, 11, "agent:alice");
  assert.equal(host.turnTabs.size, 1);
  assert.equal(next.surfaceId, "surface-1");
});
