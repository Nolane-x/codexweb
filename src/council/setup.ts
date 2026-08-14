import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  currentRuntimeCommand,
  defaultConfig,
  getConfigPath,
  loadConfigForSetup,
  saveConfig,
  type AppConfig,
} from "../config";
import {
  createTunnelConfig,
  installRuntimeKey,
  installTunnelClient,
} from "../tunnel";
import { VERSION } from "../version";
import { COUNCIL_CONNECTOR_NAME } from "./wake-engine";

export interface CouncilSetupOptions {
  browserHostDescriptorPath: string;
  tunnelId?: string;
  runtimeKeyFile?: string;
}

export interface CouncilSetupResult {
  mode: "full";
  appName: string;
  configPath: string;
  reusedCredentials: boolean;
}

function existingCodexWebConfig(): AppConfig | undefined {
  if (!existsSync(getConfigPath())) return undefined;
  return loadConfigForSetup();
}

export async function setupCouncil(options: CouncilSetupOptions): Promise<CouncilSetupResult> {
  const descriptorPath = resolve(options.browserHostDescriptorPath);
  if (!existsSync(descriptorPath)) {
    throw new Error(`Launcher browser descriptor does not exist: ${descriptorPath}`);
  }

  // Council may reuse the previous codexweb Tunnel credentials, but it intentionally never reads,
  // restores, migrates, or mutates CODEX_HOME, ~/.codex/config.toml, model caches, or the legacy
  // Codex integration journal. The old app config is only a credential source.
  const existing = existingCodexWebConfig();
  const previousCouncil = existing?.mode === "full" && existing.appName === COUNCIL_CONNECTOR_NAME ? existing : undefined;
  const reusableTunnel = existing?.mode === "full" ? existing.tunnel : undefined;
  const freshCredentials = Boolean(options.tunnelId || options.runtimeKeyFile);
  if (freshCredentials && (!options.tunnelId || !options.runtimeKeyFile)) {
    throw new Error("Council setup requires both tunnelId and runtimeKeyFile when replacing tunnel credentials");
  }
  if (!freshCredentials && !reusableTunnel) {
    throw new Error("Council setup needs a Tunnel ID and Tunnels Read + Use runtime key for first-time setup");
  }

  const base = previousCouncil ?? defaultConfig("full");
  const tunnel = freshCredentials
    ? createTunnelConfig({
        binaryPath: await installTunnelClient(),
        tunnelId: options.tunnelId!,
        runtimeKeyFile: installRuntimeKey(options.runtimeKeyFile!),
        profileName: "codexweb-council",
        alias: "codexweb-council",
      })
    : createTunnelConfig({
        binaryPath: reusableTunnel!.binaryPath,
        tunnelId: reusableTunnel!.tunnelId,
        runtimeKeyFile: reusableTunnel!.runtimeKeyFile,
        profileName: "codexweb-council",
        alias: "codexweb-council",
      });

  const config: AppConfig = {
    ...base,
    version: 3,
    releaseVersion: VERSION,
    mode: "full",
    appName: COUNCIL_CONNECTOR_NAME,
    browserHost: "launcher",
    browserHostDescriptorPath: descriptorPath,
    runtimeCommand: currentRuntimeCommand(),
    tunnel,
    acknowledgedUnofficialAt: base.acknowledgedUnofficialAt ?? new Date().toISOString(),
  };
  saveConfig(config);
  return {
    mode: "full",
    appName: COUNCIL_CONNECTOR_NAME,
    configPath: getConfigPath(),
    reusedCredentials: !freshCredentials,
  };
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

export async function runCouncilSetupCommand(input: string[]): Promise<void> {
  const args = [...input];
  const descriptor = takeOption(args, "--browser-host-descriptor");
  const tunnelId = takeOption(args, "--tunnel-id");
  const runtimeKeyFile = takeOption(args, "--runtime-key-file");
  if (args.length > 0) throw new Error(`Unknown Council setup arguments: ${args.join(" ")}`);
  if (!descriptor) throw new Error("council-setup requires --browser-host-descriptor");
  const result = await setupCouncil({
    browserHostDescriptorPath: descriptor,
    ...(tunnelId ? { tunnelId } : {}),
    ...(runtimeKeyFile ? { runtimeKeyFile } : {}),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
