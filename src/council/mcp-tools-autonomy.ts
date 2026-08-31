import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { CouncilAutonomyKernel } from "./autonomy-kernel";
import { actorSchema, agentIdSchema, councilMcpResult, type ResolveCouncilActor } from "./mcp-shared";

export function registerCouncilAutonomyTools(server: McpServer, autonomy: CouncilAutonomyKernel, resolveActor: ResolveCouncilActor): void {
  server.registerTool("council_autonomy_status", {
    title: "Read Council durable autonomy status",
    description: "Read safe durable Council queue, agent health, breaker, audit-summary, and budget state. Private conversations, checkpoints, prompts, credentials, filesystem paths, and screenshots are never returned.",
    inputSchema: { ...actorSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    return councilMcpResult({ actor, autonomy: autonomy.status() });
  });

  server.registerTool("council_agent_health", {
    title: "Read managed Council agent health",
    description: "Read bounded safe health/circuit-breaker projections for all managed agents or one selected agent.",
    inputSchema: { ...actorSchema, agent_id_filter: agentIdSchema.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, agent_id_filter }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    const health = autonomy.status().health.filter(record => !agent_id_filter || record.agentId === agent_id_filter);
    return councilMcpResult({ actor, version: 1, health });
  });

  server.registerTool("council_exceptional_work", {
    title: "Read exceptional Council work",
    description: "Read safe failed or uncertain durable work that needs manager/operator attention. This does not expose prompts, conversation URLs, credentials, or screenshot bytes.",
    inputSchema: { ...actorSchema, limit: z.number().int().min(1).max(200).default(50) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, limit }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    return councilMcpResult({ actor, version: 1, work: autonomy.exceptionalWork(limit) });
  });

  server.registerTool("council_autonomy_audit", {
    title: "Read Council durable autonomy audit",
    description: "Read a bounded safe audit trail of durable Council work transitions. This contains stable IDs/status codes only and never exposes private continuity data.",
    inputSchema: { ...actorSchema, limit: z.number().int().min(1).max(200).default(100) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, limit }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    return councilMcpResult({ actor, version: 1, events: autonomy.auditList(limit) });
  });
}
