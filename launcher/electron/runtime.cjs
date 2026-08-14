const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const legacy = require("./runtime-legacy.cjs");

const COUNCIL_CONNECTOR_NAME = "CodexWeb Council";
const MCP_SETUP_TIMEOUT_MS = 10 * 60_000;

class RuntimeHost extends legacy.RuntimeHost {
  isCouncilRuntime() {
    const current = this.runtimeConfigSnapshot();
    return current.configured && current.mode === "full" && current.config?.appName === COUNCIL_CONNECTOR_NAME;
  }

  mcpConnectorName() {
    if (this.isCouncilRuntime()) return COUNCIL_CONNECTOR_NAME;
    return super.mcpConnectorName();
  }

  browserConnectorName() {
    if (this.isCouncilRuntime()) return COUNCIL_CONNECTOR_NAME;
    return super.browserConnectorName();
  }

  async doctor() {
    if (!this.isCouncilRuntime()) return super.doctor();
    try {
      const runtime = await this.supervisor.startIfConfigured();
      const ok = runtime.status === "ready";
      return {
        ok,
        checks: [{
          id: "council-runtime",
          status: ok ? "ok" : "error",
          message: ok ? "Council Secure MCP Tunnel is ready" : `Council runtime is ${runtime.status}${runtime.detail ? `: ${runtime.detail}` : ""}`,
        }],
      };
    } catch (error) {
      return { ok: false, checks: [{ id: "council-runtime", status: "error", message: error instanceof Error ? error.message : String(error) }] };
    }
  }

  setupCouncilMcp({ tunnelId = "", runtimeKey = "", replace = false } = {}) {
    if (this.currentOperation()) throw new Error(`Another launcher operation is active: ${this.currentOperation()}`);
    const reuseSavedCredentials = replace !== true && this.mcpCredentialsConfigured();
    if (!reuseSavedCredentials && !/^tunnel_[a-f0-9]{32}$/.test(tunnelId)) {
      throw new Error("Tunnel ID must be tunnel_ followed by 32 lowercase hexadecimal characters");
    }
    if (!reuseSavedCredentials && (typeof runtimeKey !== "string" || runtimeKey.trim().length < 20)) {
      throw new Error("A Tunnels Read + Use runtime key is required");
    }
    const args = ["council-setup", "--browser-host-descriptor", this.browserDescriptorPath];
    if (reuseSavedCredentials) {
      return this.runSetup("council-setup", args, {
        message: "Reconnecting ChatGPT Council with saved tunnel credentials",
        successMessage: "ChatGPT Council runtime is ready",
        timeoutMs: MCP_SETUP_TIMEOUT_MS,
      });
    }
    const secretsDir = path.join(this.app.getPath("userData"), "secrets");
    fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(secretsDir, 0o700); } catch {}
    const keyPath = path.join(secretsDir, `runtime-key-${randomBytes(16).toString("hex")}.tmp`);
    fs.writeFileSync(keyPath, runtimeKey.trim(), { flag: "wx", mode: 0o600 });
    args.push("--tunnel-id", tunnelId, "--runtime-key-file", keyPath);
    return this.runSetup("council-setup", args, {
      message: "Connecting ChatGPT Council",
      successMessage: "ChatGPT Council runtime is ready",
      timeoutMs: MCP_SETUP_TIMEOUT_MS,
    }).finally(() => fs.rmSync(keyPath, { force: true }));
  }

  async upgradeManagedRuntime() {
    if (!this.isCouncilRuntime()) return super.upgradeManagedRuntime();
    const existing = this.runtimeConfigSnapshot();
    if (existing.config?.releaseVersion === this.app.getVersion()) return { updated: false };
    const result = await this.setupCouncilMcp({ replace: false });
    return {
      updated: true,
      mode: "full",
      bridgeEnabled: false,
      fromVersion: existing.config?.releaseVersion,
      toVersion: this.app.getVersion(),
      connectorMigrated: false,
      stdout: result.stdout,
    };
  }
}

module.exports = {
  ...legacy,
  COUNCIL_CONNECTOR_NAME,
  RuntimeHost,
};
