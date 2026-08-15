import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { CouncilAutonomyKernel } from "./autonomy-kernel";
import { actorSchema, councilMcpResult, type ResolveCouncilActor } from "./mcp-shared";

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
