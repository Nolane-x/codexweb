import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { CouncilObservationStore } from "./observation-store";
import { actorSchema, councilMcpResult, type ResolveCouncilActor } from "./mcp-shared";

const runIdSchema = z.string().trim().regex(/^obs_[A-Za-z0-9_-]{12,80}$/);

export function registerCouncilObservationTools(server: McpServer, observations: CouncilObservationStore, resolveActor: ResolveCouncilActor): void {
  server.registerTool("council_observation_list", {
    title: "List retained Council supervisor observations",
    description: "Read safe summaries of retained periodic supervisor runs. This never exposes local file paths, conversation URLs, credentials, or screenshot bytes.",
    inputSchema: { ...actorSchema, limit: z.number().int().min(1).max(72).default(12) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, limit }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    return councilMcpResult({ actor, observations: observations.list().slice(0, limit) });
  });

  server.registerTool("council_observation_read", {
    title: "Read retained Council supervisor observation",
    description: "Read one safe retained supervisor record including agent health and manager analysis. Screenshot identifiers are metadata only; raw local paths and screenshot bytes are not exposed through MCP.",
    inputSchema: { ...actorSchema, run_id: runIdSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, run_id }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    const observation = observations.get(run_id);
    if (!observation) throw new Error(`Council observation does not exist: ${run_id}`);
    return councilMcpResult({ actor, observation });
  });
}
