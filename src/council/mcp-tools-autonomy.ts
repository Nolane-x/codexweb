import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CouncilAutonomyKernel } from "./autonomy-kernel";

function safeResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function registerCouncilAutonomyTools(server: McpServer, autonomy: CouncilAutonomyKernel): void {
  server.registerTool("council_autonomy_status", {
    description: "Read safe durable Council queue, agent health, breaker, audit-summary, and budget state. Private conversations, checkpoints, prompts, credentials, filesystem paths, and screenshots are never returned.",
    inputSchema: {},
  }, async () => safeResult(autonomy.status()));

  server.registerTool("council_autonomy_audit", {
    description: "Read a bounded safe audit trail of durable Council work transitions. This contains stable IDs/status codes only and never exposes private continuity data.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional().describe("Maximum recent audit records to return (default 100, maximum 200)"),
    },
  }, async ({ limit }) => safeResult({ version: 1, events: autonomy.auditList(limit ?? 100) }));
}
