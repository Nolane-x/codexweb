import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CouncilStore } from "./store";
import type { CouncilWakeDelivery } from "./mcp-shared";
import { registerCouncilDiscussionTools } from "./mcp-tools-discussion";
import { registerCouncilWorkTools } from "./mcp-tools-work";

export const COUNCIL_MCP_SERVER_NAME = "codexweb-council";
export const COUNCIL_MCP_SERVER_VERSION = "1.0.0";
export const COUNCIL_TOOL_NAMES = ["council_join", "council_room_upsert", "council_status", "council_read", "council_say", "council_propose", "council_reply", "council_decide", "council_task_create", "council_task_update", "council_wake", "council_checkpoint", "council_context", "council_agent_status"] as const;

export function createCouncilMcpServer(store: CouncilStore, options: { wakeDelivery?: CouncilWakeDelivery } = {}): McpServer {
  const server = new McpServer({ name: COUNCIL_MCP_SERVER_NAME, version: COUNCIL_MCP_SERVER_VERSION });
  const resolveActor = (_extra: unknown, explicit?: string): string => {
    if (!explicit) throw new Error("Every Council call requires agent_id; call council_join first and keep using your own stable id");
    if (!store.snapshot().agents.some(agent => agent.id === explicit)) throw new Error(`Council agent is not registered: ${explicit}; call council_join first`);
    return explicit;
  };
  registerCouncilDiscussionTools(server, store, resolveActor);
  registerCouncilWorkTools(server, store, resolveActor, options.wakeDelivery);
  return server;
}

export async function runCouncilMcpServer(options: { storePath?: string; store?: CouncilStore; wakeDelivery?: CouncilWakeDelivery }): Promise<void> {
  const store = options.store ?? (options.storePath ? new CouncilStore(options.storePath) : undefined);
  if (!store) throw new Error("Council MCP requires a store or storePath");
  await createCouncilMcpServer(store, { wakeDelivery: options.wakeDelivery }).connect(new StdioServerTransport());
}
