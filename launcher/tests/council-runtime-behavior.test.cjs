const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
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

test("Council RuntimeHost setupCouncilMcp dispatches council-setup and never Codex route operations", async () => {
  const calls = [];
  const host = Object.create(RuntimeHost.prototype);
  const configPath = path.join(os.tmpdir(), `codexweb-council-runtime-${process.pid}.json`);
  Object.assign(host, {
    browserDescriptorPath: "/private/launcher-browser.json",
    platform: process.platform,
    currentOperation: () => null,
    mcpCredentialsConfigured: () => true,
    isCouncilRuntime: () => true,
    supervisor: {
      configPath,
      stopForSetup: async () => calls.push({ name: "stop" }),
      startIfConfigured: async () => ({ status: "ready" }),
      clearState: () => calls.push({ name: "clear" }),
    },
    run: async (name, args, options) => {
      calls.push({ name, args, options });
      return { stdout: "ok" };
    },
  });
  await host.setupCouncilMcp({ replace: false });
  const setup = calls.find(call => call.name === "council-setup");
  assert.ok(setup);
  assert.equal(setup.args[0], "council-setup");
  assert.ok(!setup.args.includes("--replace-codex-route"));
  assert.ok(!setup.args.includes("route"));
  assert.ok(!setup.args.includes("setup"));
});
