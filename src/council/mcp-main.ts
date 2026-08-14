import { join } from "node:path";
import { getConfigDir, loadConfig } from "../config";
import { startCouncilHttpServer } from "./http-server";
import { CouncilStore } from "./store";
import { CouncilWakeEngine } from "./wake-engine";
import { runCouncilMcpServer } from "./mcp-server";

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

export async function runCouncilMcpMain(args: string[]): Promise<void> {
  const remaining = [...args];
  const storePath = takeOption(remaining, "--store") ?? join(getConfigDir(), "council", "state.json");
  // Accepted during migration because the existing tunnel supervisor still supplies it.
  takeOption(remaining, "--broker-socket");
  if (remaining.length > 0) throw new Error(`Unknown Council MCP arguments: ${remaining.join(" ")}`);

  const store = new CouncilStore(storePath);
  const httpServer = startCouncilHttpServer(store, {
    onError: message => console.error(`[council-http] dashboard unavailable: ${message}`),
  });
  let wakeDelivery: CouncilWakeEngine | undefined;
  try {
    const config = loadConfig();
    if (config.mode === "full") wakeDelivery = new CouncilWakeEngine(store, config);
  } catch {
    // Council discussion can run before launcher setup; wake remains durable-only.
  }

  try {
    await runCouncilMcpServer({ store, ...(wakeDelivery ? { wakeDelivery } : {}) });
  } finally {
    httpServer?.stop(true);
  }
}
