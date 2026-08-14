import { join } from "node:path";
import { getConfigDir, loadConfig } from "../config";
import { CouncilStore } from "./store";
import { CouncilWakeEngine } from "./wake-engine";
import { runCouncilMcpServer } from "./mcp-server";
function takeOption(args: string[], name: string): string | undefined { const index = args.indexOf(name); if (index < 0) return undefined; const value = args[index + 1]?.trim(); if (!value) throw new Error(`${name} requires a value`); args.splice(index, 2); return value; }
export async function runCouncilMcpMain(args: string[]): Promise<void> { const remaining = [...args]; const storePath = takeOption(remaining, "--store") ?? join(getConfigDir(), "council", "state.json"); takeOption(remaining, "--broker-socket"); if (remaining.length > 0) throw new Error(`Unknown Council MCP arguments: ${remaining.join(" ")}`); const store = new CouncilStore(storePath); let wakeDelivery: CouncilWakeEngine | undefined; try { const config = loadConfig(); if (config.mode === "full") wakeDelivery = new CouncilWakeEngine(store, config); } catch { /* Council chat can run before launcher setup; wake remains durable-only. */ } await runCouncilMcpServer({ store, ...(wakeDelivery ? { wakeDelivery } : {}) }); }
