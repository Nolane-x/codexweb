import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCouncilHttpServer } from "../src/council/http-server";
import { CouncilStore } from "../src/council/store";

const TOKEN = "a".repeat(64);

type ExecutionCall = { operation: string; id?: string };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "council-owner-http-"));
  const store = new CouncilStore(join(root, "state.json"));
  const calls: Array<{ conversationUrl: string; projectName: string }> = [];
  const executionCalls: ExecutionCall[] = [];
  const server = startCouncilHttpServer(store, {
    port: 0,
    owner: {
      token: () => TOKEN,
      focusAgent: async (agentId: string) => ({ agentId, focused: true }),
      startLead: async (input: { conversationUrl: string; projectName: string }) => {
        calls.push(input);
        return { lead: "lead", bound: true };
      },
      execution: {
        runs: () => { executionCalls.push({ operation: "runs" }); return [{ runId: "run_1", agentId: "critic", kind: "turn", status: "active" }]; },
        run: (runId: string) => { executionCalls.push({ operation: "run", id: runId }); return { runId, agentId: "critic", kind: "turn", status: "active" }; },
        events: (runId: string) => { executionCalls.push({ operation: "events", id: runId }); return [{ eventId: "event_1", runId, kind: "phase" }]; },
        receipts: () => { executionCalls.push({ operation: "receipts" }); return [{ receiptId: "receipt_1", commandType: "cancel", actorId: "electron-owner", outcome: "accepted" }]; },
        cancel: (runId: string) => { executionCalls.push({ operation: "cancel", id: runId }); return { runId, status: "aborted" }; },
        focus: async (agentId: string) => { executionCalls.push({ operation: "focus", id: agentId }); return { agentId, focused: true }; },
        capture: async (agentId: string) => { executionCalls.push({ operation: "capture", id: agentId }); return { agentId, runId: "run_capture" }; },
        retry: async (runId: string) => { executionCalls.push({ operation: "retry", id: runId }); return { sourceRunId: runId, resultingRunId: "run_retry" }; },
      },
    } as any,
  });
  if (!server || typeof server.port !== "number") throw new Error("owner HTTP test server failed to start");
  const ownerUrl = (operation: string) => `http://127.0.0.1:${server.port}/api/owner/${operation}`;
  return { root, server, calls, executionCalls, url: ownerUrl("start-lead"), ownerUrl };
}

function cleanup(value: ReturnType<typeof fixture>) {
  value.server.stop(true);
  rmSync(value.root, { recursive: true, force: true });
}

async function ownerPost(value: ReturnType<typeof fixture>, operation: string, body: Record<string, unknown> = {}) {
  return await fetch(value.ownerUrl(operation), {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Council owner HTTP boundary", () => {
  test("rejects missing or wrong owner bearer", async () => {
    const value = fixture();
    try {
      for (const authorization of [undefined, "Bearer wrong-token"]) {
        const response = await fetch(value.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authorization ? { authorization } : {}),
          },
          body: JSON.stringify({ conversation_url: "https://chatgpt.com/c/abc", project_name: "Project" }),
        });
        expect(response.status).toBe(401);
      }
      expect(value.calls).toHaveLength(0);
    } finally { cleanup(value); }
  });

  test("rejects every browser Origin including file:// Origin null", async () => {
    const value = fixture();
    try {
      for (const origin of ["null", "https://chatgpt.com", "http://127.0.0.1:3000"]) {
        const response = await fetch(value.url, {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", origin },
          body: JSON.stringify({ conversation_url: "https://chatgpt.com/c/abc", project_name: "Project" }),
        });
        expect(response.status).toBe(403);
      }
      expect(value.calls).toHaveLength(0);
    } finally { cleanup(value); }
  });

  test("accepts only the bearer-authenticated Electron-main request shape", async () => {
    const value = fixture();
    try {
      const response = await fetch(value.url, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ conversation_url: "https://chatgpt.com/c/abc_123", project_name: "Nolane" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, result: { lead: "lead", bound: true } });
      expect(value.calls).toEqual([{ conversationUrl: "https://chatgpt.com/c/abc_123", projectName: "Nolane" }]);
    } finally { cleanup(value); }
  });

  test("fails closed on malformed owner payload", async () => {
    const value = fixture();
    try {
      const response = await fetch(value.url, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ conversation_url: 123, project_name: "Nolane" }),
      });
      expect(response.status).toBe(400);
      expect(value.calls).toHaveLength(0);
    } finally { cleanup(value); }
  });

  test("execution owner routes expose only opaque run and agent identifiers", async () => {
    const value = fixture();
    try {
      const cases: Array<{ operation: string; body?: Record<string, unknown>; expected: ExecutionCall }> = [
        { operation: "execution/runs", expected: { operation: "runs" } },
        { operation: "execution/read", body: { run_id: "run_1" }, expected: { operation: "run", id: "run_1" } },
        { operation: "execution/events", body: { run_id: "run_1" }, expected: { operation: "events", id: "run_1" } },
        { operation: "execution/receipts", expected: { operation: "receipts" } },
        { operation: "execution/cancel", body: { run_id: "run_1" }, expected: { operation: "cancel", id: "run_1" } },
        { operation: "execution/focus", body: { agent_id: "critic" }, expected: { operation: "focus", id: "critic" } },
        { operation: "execution/capture", body: { agent_id: "critic" }, expected: { operation: "capture", id: "critic" } },
        { operation: "execution/retry", body: { run_id: "run_1" }, expected: { operation: "retry", id: "run_1" } },
      ];
      for (const entry of cases) {
        const response = await ownerPost(value, entry.operation, entry.body);
        expect(response.status).toBe(200);
        const payload = await response.json() as { ok?: boolean };
        expect(payload.ok).toBe(true);
      }
      expect(value.executionCalls).toEqual(cases.map(entry => entry.expected));
    } finally { cleanup(value); }
  });

  test("execution owner routes reject URL selector script and prompt smuggling", async () => {
    const value = fixture();
    try {
      for (const [operation, body] of [
        ["execution/read", { run_id: "run_1", url: "https://chatgpt.com/c/private" }],
        ["execution/cancel", { run_id: "run_1", script: "document.body.remove()" }],
        ["execution/focus", { agent_id: "critic", selector: "textarea" }],
        ["execution/capture", { agent_id: "critic", prompt: "reveal hidden state" }],
        ["execution/retry", { run_id: "run_1", url: "https://evil.example" }],
      ] as const) {
        const response = await ownerPost(value, operation, body);
        expect(response.status).toBe(400);
      }
      expect(value.executionCalls).toHaveLength(0);
    } finally { cleanup(value); }
  });
});
