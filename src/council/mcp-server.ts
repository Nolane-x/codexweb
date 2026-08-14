import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CouncilManagedRuntime } from "./managed-runtime";
import { registerCouncilManagedTools } from "./mcp-tools-managed";
import type { CouncilWakeDelivery } from "./mcp-shared";
import { registerCouncilDiscussionTools } from "./mcp-tools-discussion";
import { registerCouncilWorkTools } from "./mcp-tools-work";
import { CouncilStore } from "./store";

export const COUNCIL_MCP_SERVER_NAME = "codexweb-council";
export const COUNCIL_MCP_SERVER_VERSION = "1.2.0";
export const COUNCIL_TOOL_NAMES = [
  "council_join",
  "council_room_upsert",
  "council_status",
  "council_read",
  "council_say",
  "council_propose",
  "council_reply",
  "council_decide",
  "council_task_create",
  "council_task_update",
  "council_wake",
  "council_checkpoint",
  "council_context",
  "council_agent_status",
  "council_start_project",
  "council_spawn_agent",
  "council_managed_status",
] as const;

export interface CouncilMcpServerOptions {
  wakeDelivery?: CouncilWakeDelivery;
  managedRuntime?: CouncilManagedRuntime;
}

export function createCouncilMcpServer(store: CouncilStore, options: CouncilMcpServerOptions = {}): McpServer {
  const server = new McpServer({ name: COUNCIL_MCP_SERVER_NAME, version: COUNCIL_MCP_SERVER_VERSION });
  const resolveActor = (_extra: unknown, explicit?: string, token?: string): string => {
    if (!explicit || !token) throw new Error("Every Council call requires agent_id and agent_token; call council_join first and keep the private capability it returns");
    return store.authenticateAgent(explicit, token).id;
  };
  registerCouncilDiscussionTools(server, store, resolveActor, options.managedRuntime);
  registerCouncilWorkTools(server, store, resolveActor, options.wakeDelivery, options.managedRuntime);
  if (options.managedRuntime) registerCouncilManagedTools(server, options.managedRuntime, resolveActor);
  return server;
}

export async function runCouncilMcpServer(options: { storePath?: string; store?: CouncilStore; wakeDelivery?: CouncilWakeDelivery; managedRuntime?: CouncilManagedRuntime }): Promise<void> {
  const store = options.store ?? (options.storePath ? new CouncilStore(options.storePath) : undefined);
  if (!store) throw new Error("Council MCP requires a store or storePath");
  await createCouncilMcpServer(store, { wakeDelivery: options.wakeDelivery, managedRuntime: options.managedRuntime }).connect(new StdioServerTransport());
}
