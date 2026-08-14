import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const councilSetup = readFileSync(join(root, "src", "council", "setup.ts"), "utf8");
const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");
const launcherRuntime = readFileSync(join(root, "launcher", "electron", "runtime.cjs"), "utf8");
const supervisor = readFileSync(join(root, "launcher", "electron", "runtime-supervisor.cjs"), "utf8");
const entrypoint = readFileSync(join(root, "launcher", "electron", "main-council.cjs"), "utf8");
const preload = readFileSync(join(root, "launcher", "electron", "preload.cjs"), "utf8");

describe("Council standalone product boundary", () => {
  test("Tunnel setup never reads, restores, installs, or removes a Codex route", () => {
    expect(councilSetup).not.toContain("codex-route-removal");
    expect(councilSetup).not.toContain("removeManagedCodexRoute");
    expect(councilSetup).not.toContain("installCodexIntegration");
    expect(councilSetup).not.toContain("uninstallCodexIntegration");
    expect(councilSetup).not.toContain("preflightCodexIntegration");
    expect(councilSetup).toContain("COUNCIL_CONNECTOR_NAME");
  });

  test("packaged Council entrypoint does not load the legacy Codex launcher main", () => {
    expect(entrypoint).toContain('CODEXWEB_COUNCIL_PRODUCT = "1"');
    expect(entrypoint).not.toContain('require("./main.cjs")');
    expect(entrypoint).not.toContain("setupCore");
    expect(entrypoint).not.toContain("setBridgeEnabled");
    expect(entrypoint).not.toContain("restoreCodexRoute");
    expect(preload).not.toContain("setBridgeEnabled");
    expect(preload).not.toContain("uninstallIntegration");
    expect(preload).not.toContain("setupCore");
  });

  test("CLI has a dedicated Council setup command", () => {
    expect(cli).toContain('command === "council-setup"');
    expect(cli).toContain("runCouncilSetupCommand");
  });

  test("launcher Tunnel setup invokes Council setup without Codex route replacement", () => {
    expect(launcherRuntime).toContain('["council-setup", "--browser-host-descriptor"');
    expect(launcherRuntime).not.toContain("--replace-codex-route");
    expect(launcherRuntime).toContain('COUNCIL_CONNECTOR_NAME = "CodexWeb Council"');
  });

  test("Council supervisor starts only the Tunnel and never a Responses daemon", () => {
    const councilStart = supervisor.slice(supervisor.indexOf("async startConfigured()"), supervisor.indexOf("async recover(name)"));
    expect(councilStart).toContain("await this.startTunnel");
    expect(councilStart).not.toContain("startDaemon");
    expect(councilStart).toContain("daemonPid: null");
  });
});
