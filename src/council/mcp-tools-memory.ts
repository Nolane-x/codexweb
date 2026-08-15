import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { CouncilMemoryIndex, CouncilMemorySourceType } from "./memory-index";
import { actorSchema, councilMcpResult, type ResolveCouncilActor } from "./mcp-shared";

const sourceType = z.enum(["manager-analysis", "observation", "decision", "task", "audit", "digest"] as const);

export function registerCouncilMemoryTools(server: McpServer, memory: CouncilMemoryIndex, resolveActor: ResolveCouncilActor): void {
  server.registerTool("council_memory_search", {
    title: "Search retained Council memory",
    description: "Search bounded safe long-horizon Council project memory with provenance. This never returns private conversation URLs, private checkpoints, credentials, local filesystem paths, prompt bodies, or screenshot bytes.",
    inputSchema: {
      ...actorSchema,
      room_id: z.string().trim().min(1).max(128),
      query: z.string().trim().min(2).max(500),
      limit: z.number().int().min(1).max(50).default(10),
      source_types: z.array(sourceType).max(6).optional(),
      agent_id_filter: z.string().trim().min(1).max(128).optional(),
      task_id_filter: z.string().trim().min(1).max(128).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, room_id, query, limit, source_types, agent_id_filter, task_id_filter }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    const results = memory.search({ projectRoomId: room_id, query, limit, sourceTypes: source_types as CouncilMemorySourceType[] | undefined, agentId: agent_id_filter, taskId: task_id_filter });
    return councilMcpResult({ actor, version: 1, results });
  });

  server.registerTool("council_memory_recent", {
    title: "Read recent retained Council memory",
    description: "Read recent safe long-horizon Council memory entries with provenance for project continuity.",
    inputSchema: {
      ...actorSchema,
      room_id: z.string().trim().min(1).max(128),
      limit: z.number().int().min(1).max(100).default(20),
      source_types: z.array(sourceType).max(6).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, room_id, limit, source_types }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    return councilMcpResult({ actor, version: 1, results: memory.recent({ projectRoomId: room_id, limit, sourceTypes: source_types as CouncilMemorySourceType[] | undefined }) });
  });
}
