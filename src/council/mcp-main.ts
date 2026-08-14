import { dirname, join } from "node:path";
import { getConfigDir, loadConfig } from "../config";
import { CouncilAgentRegistry } from "./agent-registry";
import { CouncilBrowserTransport } from "./browser-transport";
import { parseCouncilActionFooter } from "./browser-action-parser";
import { HybridCouncilWakeDelivery } from "./hybrid-wake-delivery";
import { startCouncilHttpServer } from "./http-server";
import { createLauncherPersistentTurnControl } from "./launcher-turn-control";
import { ManagedAgentStateStore } from "./managed-agent-state";
import { ManagedProjectStateStore } from "./managed-project-state";
import { CouncilManagedRuntime } from "./managed-runtime";
import { runCouncilMcpServer } from "./mcp-server";
import { PlaywrightCouncilChatDriver } from "./playwright-council-driver";
import { CouncilStore } from "./store";
import { CouncilWakeEngine } from "./wake-engine";

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

  let managedRuntime: CouncilManagedRuntime | undefined;
  let fallbackWake: CouncilWakeEngine | undefined;
  try {
    const config = loadConfig();
    if (config.browserHost === "launcher" && config.browserHostDescriptorPath) {
      const councilDir = dirname(storePath);
      const control = createLauncherPersistentTurnControl(config.browserHostDescriptorPath);
      const transport = new CouncilBrowserTransport(control, new PlaywrightCouncilChatDriver(config.browserHostDescriptorPath));
      managedRuntime = new CouncilManagedRuntime({
        council: store,
        managed: new ManagedAgentStateStore(join(councilDir, "managed-agents.json")),
        project: new ManagedProjectStateStore(join(councilDir, "managed-project.json")),
        registry: new CouncilAgentRegistry(),
        transport,
        parseAnswer: parseCouncilActionFooter,
      });
    }
    if (config.mode === "full") fallbackWake = new CouncilWakeEngine(store, config);
  } catch (error) {
    // Council discussion can run before launcher setup. Managed Playwright and automatic wake remain unavailable.
    const message = error instanceof Error ? error.message : String(error);
    console.info(`[council-runtime] managed browser transport unavailable: ${message}`);
  }

  const wakeDelivery = managedRuntime || fallbackWake
    ? new HybridCouncilWakeDelivery(store, managedRuntime, fallbackWake)
    : undefined;

  try {
    await runCouncilMcpServer({
      store,
      ...(wakeDelivery ? { wakeDelivery } : {}),
      ...(managedRuntime ? { managedRuntime } : {}),
    });
  } finally {
    httpServer?.stop(true);
  }
}
