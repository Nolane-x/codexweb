const legacy = require("./runtime-supervisor-legacy.cjs");
const { setCouncilRuntimeLive } = require("./council-runtime-evidence.cjs");

const COUNCIL_CONNECTOR_NAME = "CodexWeb Council";

function councilProduct() { return process.env.CODEXWEB_COUNCIL_PRODUCT === "1"; }
function isCouncilConfig(config) {
  return config?.mode === "full" && config?.appName === COUNCIL_CONNECTOR_NAME;
}

class RuntimeSupervisor extends legacy.RuntimeSupervisor {
  async startConfigured() {
    let config;
    try {
      config = this.readConfig();
    } catch {
      if (!councilProduct()) return super.startConfigured();
      setCouncilRuntimeLive(false);
      this.writeState("not-configured");
      return { status: "not-configured" };
    }
    if (!isCouncilConfig(config)) {
      if (!councilProduct()) return super.startConfigured();
      setCouncilRuntimeLive(false);
      // A legacy codexweb config is foreign to the Council product. Never start or migrate it.
      this.writeState("not-configured");
      return { status: "not-configured" };
    }
    if (config.releaseVersion !== this.app.getVersion()) {
      setCouncilRuntimeLive(false);
      const detail = `Council config requires ${config.releaseVersion}; launcher is ${this.app.getVersion()}`;
      this.writeState("needs-setup", detail);
      return { status: "needs-setup", detail };
    }

    this.stopping = false;
    setCouncilRuntimeLive(false);
    this.publishOperation?.({ name: "runtime-start", status: "running", message: "Starting ChatGPT Council tunnel" });
    try {
      if (this.daemon) await this.stopChild("daemon");
      await this.startTunnel(config, "runtime-start");
      this.restartHistory.daemon = [];
      this.restartHistory.tunnel = [];
      this.writeState("ready");
      setCouncilRuntimeLive(true);
      this.publishOperation?.({ name: "runtime-start", status: "completed", message: "ChatGPT Council tunnel is ready" });
      return { status: "ready", daemonPid: null, tunnelPid: this.tunnel?.pid };
    } catch (error) {
      setCouncilRuntimeLive(false);
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
    let config;
    try { config = this.readConfig(); }
    catch {
      if (councilProduct()) { setCouncilRuntimeLive(false); return; }
      return super.recover(name);
    }
    if (!isCouncilConfig(config)) {
      if (councilProduct()) { setCouncilRuntimeLive(false); return; }
      return super.recover(name);
    }
    if (this.stopping || name !== "tunnel") return;
    this.publishOperation?.({ name: "runtime-recovery", status: "running", message: "Restarting Council tunnel" });
    setCouncilRuntimeLive(false);
    await this.startTunnel(config, "runtime-recovery");
    if (!this.tunnel || !await this.tunnelHealth(config)) throw new Error("Council tunnel is unavailable after recovery");
    if (!this.tryWriteState("ready")) throw new Error("Recovered Council runtime could not persist launcher ownership");
    this.publishOperation?.({ name: "runtime-recovery", status: "completed", message: "Council tunnel recovered" });
    setCouncilRuntimeLive(true);
  }

  async shutdown() {
    try {
      return await super.shutdown();
    } finally {
      setCouncilRuntimeLive(false);
    }
  }

  async ownedRuntimeReady(config) {
    if (!isCouncilConfig(config)) return councilProduct() ? false : super.ownedRuntimeReady(config);
    return Boolean(this.tunnel && await this.tunnelHealth(config));
  }
}

module.exports = {
  ...legacy,
  COUNCIL_CONNECTOR_NAME,
  RuntimeSupervisor,
};
