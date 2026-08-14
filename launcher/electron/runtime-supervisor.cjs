const legacy = require("./runtime-supervisor-legacy.cjs");

const COUNCIL_CONNECTOR_NAME = "CodexWeb Council";

function isCouncilConfig(config) {
  return config?.mode === "full" && config?.appName === COUNCIL_CONNECTOR_NAME;
}

class RuntimeSupervisor extends legacy.RuntimeSupervisor {
  async startConfigured() {
    let config;
    try {
      config = this.readConfig();
    } catch {
      return super.startConfigured();
    }
    if (!isCouncilConfig(config)) return super.startConfigured();
    if (config.releaseVersion !== this.app.getVersion()) {
      const detail = `Config requires ${config.releaseVersion}; launcher is ${this.app.getVersion()}`;
      this.writeState("needs-setup", detail);
      return { status: "needs-setup", detail };
    }

    this.stopping = false;
    this.publishOperation?.({ name: "runtime-start", status: "running", message: "Starting ChatGPT Council tunnel" });
    try {
      if (this.daemon) await this.stopChild("daemon");
      await this.startTunnel(config, "runtime-start");
      this.restartHistory.daemon = [];
      this.restartHistory.tunnel = [];
      this.writeState("ready");
      this.publishOperation?.({ name: "runtime-start", status: "completed", message: "ChatGPT Council tunnel is ready" });
      return { status: "ready", daemonPid: null, tunnelPid: this.tunnel?.pid };
    } catch (error) {
      this.stopping = true;
      let cleanupError;
      try { await this.cleanupFailedStart(config); } catch (caught) { cleanupError = caught; }
      finally { this.stopping = false; }
      const primary = error instanceof Error ? error.message : String(error);
      const message = cleanupError ? `${primary}; Council startup cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}` : primary;
      this.tryWriteState("failed", message);
      this.publishOperation?.({ name: "runtime-start", status: "failed", message });
      throw new Error(message);
    }
  }

  async recover(name) {
    const config = this.readConfig();
    if (!isCouncilConfig(config)) return super.recover(name);
    if (this.stopping) return;
    if (name !== "tunnel") return;
    this.publishOperation?.({ name: "runtime-recovery", status: "running", message: "Restarting Council tunnel" });
    await this.startTunnel(config, "runtime-recovery");
    if (!this.tunnel || !await this.tunnelHealth(config)) throw new Error("Council tunnel is unavailable after recovery");
    if (!this.tryWriteState("ready")) throw new Error("Recovered Council runtime could not persist launcher ownership");
    this.publishOperation?.({ name: "runtime-recovery", status: "completed", message: "Council tunnel recovered" });
  }

  async ownedRuntimeReady(config) {
    if (!isCouncilConfig(config)) return super.ownedRuntimeReady(config);
    return Boolean(this.tunnel && await this.tunnelHealth(config));
  }
}

module.exports = {
  ...legacy,
  COUNCIL_CONNECTOR_NAME,
  RuntimeSupervisor,
};
