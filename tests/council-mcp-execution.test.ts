import { describe, expect, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CouncilExecutionControlPlane } from "../src/council/execution-control-plane";
import { registerCouncilExecutionTools } from "../src/council/mcp-tools-execution";

type Handler = (input: Record<string, any>, extra: unknown) => Promise<any>;

function fakeServer() {
  const tools = new Map<string, { definition: any; handler: Handler }>();
  const server = {
    registerTool(name: string, definition: any, handler: Handler) {
      tools.set(name, { definition, handler });
    },
  } as unknown as McpServer;
  return { server, tools };
}

function fixture() {
  let sequence = 0;
  const execution = new CouncilExecutionControlPlane({
    now: () => Date.parse("2026-08-31T14:00:00.000Z") + sequence,
    id: prefix => `${prefix}_${++sequence}`,
  });
  const managed = [
    { id: "lead", permissions: ["wake", "review"] as const },
    { id: "reviewer", permissions: ["review"] as const },
    { id: "observer", permissions: [] as const },
  ];
  const calls = { focus: [] as string[], capture: [] as string[] };
  const runtime = {
    publicAgents: () => managed,
    async focusAgentConversation(agentId: string) {
      calls.focus.push(agentId);
      return { conversationUrl: "https://chatgpt.com/c/private" };
    },
    async captureAgent(agentId: string) {
      calls.capture.push(agentId);
      return { png: Buffer.from("private-image"), conversationUrl: "https://chatgpt.com/c/private", health: "healthy" as const };
    },
  };
  const resolveActor = (_extra: unknown, explicit?: string, token?: string) => {
    if (!explicit || token !== "T".repeat(43)) throw new Error("auth required");
    return explicit;
  };
  const { server, tools } = fakeServer();
  registerCouncilExecutionTools(server, { execution, runtime: runtime as any }, resolveActor);
  return { execution, runtime, calls, tools };
}

function input(agentId: string, extra: Record<string, unknown> = {}) {
  return { agent_id: agentId, agent_token: "T".repeat(43), ...extra };
}

function structured(result: any): Record<string, any> {
  return result.structuredContent as Record<string, any>;
}

describe("Council MCP execution facade", () => {
  test("registers exactly the eight focused execution tools with actor credentials", () => {
    const { tools } = fixture();
    expect([...tools.keys()].sort()).toEqual([
      "council_execution_cancel",
      "council_execution_capture",
      "council_execution_events",
      "council_execution_focus",
      "council_execution_list",
      "council_execution_read",
      "council_execution_receipts",
      "council_execution_retry",
    ]);
    for (const { definition } of tools.values()) {
      expect(definition.inputSchema.agent_id).toBeDefined();
      expect(definition.inputSchema.agent_token).toBeDefined();
    }
  });

  test("read tools require a managed participant and expose no private browser continuity", async () => {
    const { execution, tools } = fixture();
    const run = execution.createRun({ traceId: "trace_public", agentId: "reviewer", kind: "turn", conversationBound: true });
    execution.recordPhase(run.runId, "conversation-ready");
    const list = structured(await tools.get("council_execution_list")!.handler(input("observer"), {}));
    const read = structured(await tools.get("council_execution_read")!.handler(input("observer", { run_id: run.runId }), {}));
    const events = structured(await tools.get("council_execution_events")!.handler(input("observer", { run_id: run.runId }), {}));
    const serialized = JSON.stringify({ list, read, events });
    for (const forbidden of ["conversationUrl", "checkpoint", "prompt", "cookie", "token", "selector", "javascript", "private-image"]) {
      expect(serialized).not.toContain(forbidden);
    }
    await expect(tools.get("council_execution_list")!.handler(input("outsider"), {})).rejects.toThrow(/managed Council participant/i);
  });

  test("cancel uses wake permission, aborts the private handle, and audits both rejection and acceptance", async () => {
    const { execution, tools } = fixture();
    const rejectedRun = execution.createRun({ traceId: "trace_reject", agentId: "reviewer", kind: "turn" });
    execution.registerCancellation(rejectedRun.runId, new AbortController());
    await expect(tools.get("council_execution_cancel")!.handler(input("reviewer", { run_id: rejectedRun.runId }), {})).rejects.toThrow(/wake permission/i);

    const acceptedRun = execution.createRun({ traceId: "trace_accept", agentId: "reviewer", kind: "turn" });
    const controller = new AbortController();
    execution.registerCancellation(acceptedRun.runId, controller);
    const accepted = structured(await tools.get("council_execution_cancel")!.handler(input("lead", { run_id: acceptedRun.runId }), {}));

    expect(controller.signal.aborted).toBe(true);
    expect(execution.readRun(acceptedRun.runId)?.status).toBe("aborted");
    expect(accepted.run.status).toBe("aborted");
    expect(execution.receipts().map(receipt => receipt.outcome)).toEqual(["rejected", "accepted"]);
  });

  test("focus and capture use review permission and return only public execution metadata", async () => {
    const { calls, tools } = fixture();
    const focus = structured(await tools.get("council_execution_focus")!.handler(input("reviewer", { target_agent_id: "lead" }), {}));
    const capture = structured(await tools.get("council_execution_capture")!.handler(input("reviewer", { target_agent_id: "lead" }), {}));
    expect(calls.focus).toEqual(["lead"]);
    expect(calls.capture).toEqual(["lead"]);
    expect(JSON.stringify({ focus, capture })).not.toContain("chatgpt.com");
    expect(JSON.stringify({ focus, capture })).not.toContain("private-image");
    await expect(tools.get("council_execution_focus")!.handler(input("observer", { target_agent_id: "lead" }), {})).rejects.toThrow(/review permission/i);
  });

  test("safe pre-submit retry consumes a private replay handle and returns the new public run", async () => {
    const { execution, tools } = fixture();
    const source = execution.createRun({ traceId: "trace_source", agentId: "reviewer", kind: "turn" });
    execution.registerRetry(source.runId, async () => {
      const next = execution.createRun({ traceId: "trace_retry", agentId: "reviewer", kind: "turn" });
      execution.completeRun(next.runId);
      return next.runId;
    });
    execution.failRun(source.runId, { failureCode: "SURFACE_UNAVAILABLE", message: "surface lost before submit" });

    const result = structured(await tools.get("council_execution_retry")!.handler(input("lead", { run_id: source.runId }), {}));

    expect(result.source_run.runId).toBe(source.runId);
    expect(result.resulting_run.status).toBe("completed");
    expect(result.resulting_run.runId).not.toBe(source.runId);
    expect(execution.receipts().at(-1)?.resultingRunId).toBe(result.resulting_run.runId);
    await expect(tools.get("council_execution_retry")!.handler(input("lead", { run_id: source.runId }), {})).rejects.toThrow(/replay.*available|already.*retried/i);
  });

  test("retry rejects at the submission boundary and records the rejected command", async () => {
    const { execution, tools } = fixture();
    const source = execution.createRun({ traceId: "trace_uncertain", agentId: "reviewer", kind: "turn" });
    execution.recordPhase(source.runId, "submit-started");
    execution.failRun(source.runId, { failureCode: "SUBMISSION_UNCERTAIN", message: "delivery unknown", uncertain: true });

    await expect(tools.get("council_execution_retry")!.handler(input("lead", { run_id: source.runId }), {})).rejects.toThrow(/operator resolution|cannot be retried|submission/i);
    const receipt = execution.receipts().at(-1)!;
    expect(receipt.commandType).toBe("retry");
    expect(receipt.outcome).toBe("rejected");
    expect(receipt.targetRunId).toBe(source.runId);
  });
});
