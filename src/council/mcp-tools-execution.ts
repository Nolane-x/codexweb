import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { CouncilExecutionControlPlane, CouncilExecutionRun } from "./execution-control-plane";
import { assertCouncilExecutionPermission, type CouncilExecutionCommand } from "./execution-policy";
import type { CouncilPermission } from "./managed-agent-state";
import { actorSchema, agentIdSchema, councilMcpResult, type ResolveCouncilActor } from "./mcp-shared";

const runIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const receiptLimitSchema = z.number().int().min(1).max(200).default(100);

export interface CouncilExecutionMcpRuntime {
  publicAgents(): Array<{ id: string; permissions: readonly CouncilPermission[] }>;
  focusAgentConversation(agentId: string): Promise<unknown>;
  captureAgent(agentId: string): Promise<unknown>;
}

export interface CouncilExecutionToolOptions {
  execution: CouncilExecutionControlPlane;
  runtime: CouncilExecutionMcpRuntime;
}

function boundedReason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "Execution command failed"))
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500);
}

function managedActor(runtime: CouncilExecutionMcpRuntime, actorId: string): { id: string; permissions: readonly CouncilPermission[] } {
  const actor = runtime.publicAgents().find(candidate => candidate.id === actorId);
  if (!actor) throw new Error(`Council execution access requires a managed Council participant: ${actorId}`);
  return actor;
}

function requireRun(execution: CouncilExecutionControlPlane, runId: string): CouncilExecutionRun {
  const run = execution.readRun(runId);
  if (!run) throw new Error(`Council execution run does not exist: ${runId}`);
  return run;
}

function latestRun(execution: CouncilExecutionControlPlane, agentId: string, kind: CouncilExecutionRun["kind"]): CouncilExecutionRun | null {
  return execution.listRuns().find(run => run.agentId === agentId && run.kind === kind) ?? null;
}

async function executeCommand<T>(input: {
  execution: CouncilExecutionControlPlane;
  runtime: CouncilExecutionMcpRuntime;
  actorId: string;
  command: CouncilExecutionCommand;
  targetRunId?: string;
  targetAgentId?: string;
  action: () => Promise<T>;
  acceptedReason: (value: T) => string;
  resultingRunId?: (value: T) => string | undefined;
}): Promise<{ value: T; receipt: ReturnType<CouncilExecutionControlPlane["recordCommandReceipt"]> }> {
  try {
    assertCouncilExecutionPermission(managedActor(input.runtime, input.actorId), input.command);
    const value = await input.action();
    const receipt = input.execution.recordCommandReceipt({
      commandType: input.command.type,
      actorId: input.actorId,
      ...(input.targetRunId ? { targetRunId: input.targetRunId } : {}),
      ...(input.targetAgentId ? { targetAgentId: input.targetAgentId } : {}),
      outcome: "accepted",
      reason: input.acceptedReason(value),
      ...(input.resultingRunId?.(value) ? { resultingRunId: input.resultingRunId(value) } : {}),
    });
    return { value, receipt };
  } catch (error) {
    input.execution.recordCommandReceipt({
      commandType: input.command.type,
      actorId: input.actorId,
      ...(input.targetRunId ? { targetRunId: input.targetRunId } : {}),
      ...(input.targetAgentId ? { targetAgentId: input.targetAgentId } : {}),
      outcome: "rejected",
      reason: boundedReason(error),
    });
    throw error;
  }
}

export function registerCouncilExecutionTools(server: McpServer, options: CouncilExecutionToolOptions, resolveActor: ResolveCouncilActor): void {
  const { execution, runtime } = options;

  server.registerTool("council_execution_list", {
    title: "List managed browser executions",
    description: "List bounded public execution runs. Private prompts, conversation URLs, browser selectors, credentials and page content are never returned.",
    inputSchema: { ...actorSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    managedActor(runtime, actor);
    return councilMcpResult({ actor, runs: execution.listRuns() });
  });

  server.registerTool("council_execution_read", {
    title: "Read managed browser execution",
    description: "Read one public execution run by opaque run ID.",
    inputSchema: { ...actorSchema, run_id: runIdSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, run_id }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    managedActor(runtime, actor);
    return councilMcpResult({ actor, run: requireRun(execution, run_id) });
  });

  server.registerTool("council_execution_events", {
    title: "Read execution timeline",
    description: "Read the bounded observable event timeline for one execution run without hidden reasoning or raw browser state.",
    inputSchema: { ...actorSchema, run_id: runIdSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, run_id }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    managedActor(runtime, actor);
    requireRun(execution, run_id);
    return councilMcpResult({ actor, run_id, events: execution.events(run_id) });
  });

  server.registerTool("council_execution_receipts", {
    title: "Read execution command receipts",
    description: "Read bounded immutable receipts for accepted and rejected execution commands.",
    inputSchema: { ...actorSchema, limit: receiptLimitSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, limit }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    managedActor(runtime, actor);
    return councilMcpResult({ actor, receipts: execution.receipts(limit) });
  });

  server.registerTool("council_execution_cancel", {
    title: "Cancel local execution",
    description: "Abort one active local execution. If ChatGPT submission may already have occurred the run becomes uncertain; cancellation never claims remote non-delivery.",
    inputSchema: { ...actorSchema, run_id: runIdSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ agent_id, agent_token, run_id }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    requireRun(execution, run_id);
    const { value: run, receipt } = await executeCommand({
      execution,
      runtime,
      actorId: actor,
      command: { type: "cancel", runId: run_id },
      targetRunId: run_id,
      action: async () => execution.cancelRun(run_id, `Execution cancellation requested by managed actor ${actor}`),
      acceptedReason: value => value.status === "uncertain" ? "Local cancellation accepted after submission boundary; remote delivery remains uncertain" : "Local execution cancellation accepted before submission boundary",
    });
    return councilMcpResult({ run, receipt });
  });

  server.registerTool("council_execution_focus", {
    title: "Focus managed agent conversation",
    description: "Focus a trusted controller-held managed conversation by agent identity. No URL or selector input is accepted.",
    inputSchema: { ...actorSchema, target_agent_id: agentIdSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, target_agent_id }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    const { receipt } = await executeCommand({
      execution,
      runtime,
      actorId: actor,
      command: { type: "focus", agentId: target_agent_id },
      targetAgentId: target_agent_id,
      action: async () => {
        await runtime.focusAgentConversation(target_agent_id);
        return latestRun(execution, target_agent_id, "focus");
      },
      acceptedReason: () => "Trusted managed conversation focus completed",
      resultingRunId: value => value?.runId,
    });
    return councilMcpResult({ target_agent_id, run: latestRun(execution, target_agent_id, "focus"), receipt });
  });

  server.registerTool("council_execution_capture", {
    title: "Capture managed agent observation",
    description: "Capture one trusted managed conversation observation by agent identity. Screenshot bytes and private conversation URLs are not returned by this facade.",
    inputSchema: { ...actorSchema, target_agent_id: agentIdSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ agent_id, agent_token, target_agent_id }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    const { receipt } = await executeCommand({
      execution,
      runtime,
      actorId: actor,
      command: { type: "capture", agentId: target_agent_id },
      targetAgentId: target_agent_id,
      action: async () => {
        await runtime.captureAgent(target_agent_id);
        return latestRun(execution, target_agent_id, "capture");
      },
      acceptedReason: () => "Trusted managed observation capture completed",
      resultingRunId: value => value?.runId,
    });
    return councilMcpResult({ target_agent_id, run: latestRun(execution, target_agent_id, "capture"), receipt });
  });

  server.registerTool("council_execution_retry", {
    title: "Retry safe pre-submit execution",
    description: "Consume a single-use private replay authority only when the source run is mechanically safe before submit. Uncertain or post-submit runs are rejected.",
    inputSchema: { ...actorSchema, run_id: runIdSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ agent_id, agent_token, run_id }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    const source = requireRun(execution, run_id);
    const { value: resultingRunId, receipt } = await executeCommand({
      execution,
      runtime,
      actorId: actor,
      command: { type: "retry", runId: run_id },
      targetRunId: run_id,
      action: async () => await execution.retryRun(run_id),
      acceptedReason: () => "Single-use safe pre-submit replay accepted",
      resultingRunId: value => value,
    });
    const resulting = requireRun(execution, resultingRunId);
    return councilMcpResult({ source_run: source, resulting_run: resulting, receipt });
  });
}
