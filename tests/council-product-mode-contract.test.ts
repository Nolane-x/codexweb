import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const councilSetup = readFileSync(join(root, "src", "council", "setup.ts"), "utf8");
const cli = readFileSync(join(root, "src", "cli.ts"), "utf8");
const launcherRuntime = readFileSync(join(root, "launcher", "electron", "runtime.cjs"), "utf8");
const supervisor = readFileSync(join(root, "launcher", "electron", "runtime-supervisor.cjs"), "utf8");

describe("Council product mode migration", () => {
  test("restores the old Codex route instead of installing a new one", () => {
    expect(councilSetup).toContain("uninstallCodexIntegration");
    expect(councilSetup).not.toContain("installCodexIntegration");
    expect(councilSetup).not.toContain("preflightCodexIntegration");
    expect(councilSetup).toContain("COUNCIL_CONNECTOR_NAME");
  });

  test("CLI has a dedicated Council setup command", () => {
    expect(cli).toContain('command === "council-setup"');
    expect(cli).toContain("runCouncilSetupCommand");
  });

  test("launcher MCP setup invokes Council setup without Codex route replacement", () => {
    expect(launcherRuntime).toContain('["council-setup", "--browser-host-descriptor"');
    expect(launcherRuntime).not.toContain("--replace-codex-route");
    expect(launcherRuntime).toContain('COUNCIL_CONNECTOR_NAME = "CodexWeb Council"');
  });

  test("Council supervisor starts the tunnel without a Responses daemon", () => {
    const councilStart = supervisor.slice(supervisor.indexOf("async startConfigured()"), supervisor.indexOf("async recover(name)"));
    expect(councilStart).toContain("await this.startTunnel");
    expect(councilStart).not.toContain("startDaemon");
    expect(councilStart).toContain("daemonPid: null");
  });
});
