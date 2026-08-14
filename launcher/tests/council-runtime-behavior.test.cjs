const test = require("node:test");
const assert = require("node:assert/strict");
const { RuntimeSupervisor } = require("../electron/runtime-supervisor.cjs");
const { RuntimeHost } = require("../electron/runtime.cjs");

const councilConfig = {
  mode: "full",
  appName: "CodexWeb Council",
  releaseVersion: "1.2.3",
};

test("Council RuntimeSupervisor starts only the tunnel", async () => {
  const calls = [];
  const supervisor = Object.create(RuntimeSupervisor.prototype);
  Object.assign(supervisor, {
    app: { getVersion: () => "1.2.3" },
    daemon: null,
    tunnel: { pid: 4321 },
    stopping: false,
    restartHistory: { daemon: [1], tunnel: [1] },
    readConfig: () => councilConfig,
    publishOperation: () => {},
    writeState: status => calls.push(["writeState", status]),
    tryWriteState: () => true,
    startTunnel: async () => calls.push(["startTunnel"]),
    startDaemon: async () => calls.push(["startDaemon"]),
    stopChild: async name => calls.push(["stopChild", name]),
    cleanupFailedStart: async () => {},
  });
  const result = await supervisor.startConfigured();
  assert.equal(result.status, "ready");
  assert.equal(result.daemonPid, null);
  assert.ok(calls.some(call => call[0] === "startTunnel"));
  assert.ok(!calls.some(call => call[0] === "startDaemon"));
});

test("Council RuntimeHost setupMcp dispatches council-setup", async () => {
  const calls = [];
  const host = Object.create(RuntimeHost.prototype);
  Object.assign(host, {
    browserDescriptorPath: "/private/launcher-browser.json",
    currentOperation: () => null,
    mcpCredentialsConfigured: () => true,
    runSetup: async (name, args, options) => {
      calls.push({ name, args, options });
      return { stdout: "ok" };
    },
  });
  await host.setupMcp({ replace: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "council-setup");
  assert.equal(calls[0].args[0], "council-setup");
  assert.ok(!calls[0].args.includes("--replace-codex-route"));
});
