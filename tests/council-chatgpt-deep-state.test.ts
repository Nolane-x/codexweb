import test from "node:test";
import assert from "node:assert/strict";
import { deriveCouncilChatGptState, councilChatGptMayRetry } from "../src/council/chatgpt-deep-state.ts";

const base = {
  composerPresent: true,
  responsePresent: false,
  assistantText: "",
  completionActionVisible: false,
  generationRunning: false,
  stopVisible: false,
  waitingUser: false,
  rateLimited: false,
  conversationLimit: false,
  connectionLost: false,
  terminalError: false,
  toolActivities: [] as Array<{ name: string; active: boolean }>,
};

test("deep thinking stays live and is never retry-safe while stop control remains", () => {
  const now = 200_000;
  const result = deriveCouncilChatGptState(
    { ...base, generationRunning: true, stopVisible: true },
    { submittedAt: 100_000 },
    { state: "THINKING", lastProgressAt: 100_000, lastAssistantText: "" },
    now,
    { deepThinkingMs: 45_000, stallMs: 90_000 },
  );
  assert.equal(result.state, "DEEP_THINKING");
  assert.equal(councilChatGptMayRetry(result), false);
  assert.ok(result.evidence.includes("stop_control_visible"));
});

test("visible active tool outranks generic thinking", () => {
  const result = deriveCouncilChatGptState(
    { ...base, generationRunning: true, stopVisible: true, toolActivities: [{ name: "Council", active: true }] },
    { submittedAt: 900 },
    {},
    1_000,
  );
  assert.equal(result.state, "TOOL_RUNNING");
  assert.ok(result.evidence.includes("visible_tool_activity"));
});

test("completion requires the same stable signature across the settle window", () => {
  const snapshot = { ...base, responsePresent: true, assistantText: "done", completionActionVisible: true };
  const first = deriveCouncilChatGptState(snapshot, {}, {}, 10_000, { completionSettleMs: 2_000 });
  assert.equal(first.state, "COMPLETING");
  const changed = deriveCouncilChatGptState({ ...snapshot, assistantText: "done!" }, {}, first, 11_500, { completionSettleMs: 2_000 });
  assert.equal(changed.state, "COMPLETING");
  const settled = deriveCouncilChatGptState({ ...snapshot, assistantText: "done!" }, {}, changed, 13_600, { completionSettleMs: 2_000 });
  assert.equal(settled.state, "COMPLETED");
  assert.ok(settled.evidence.includes("completion_stable"));
});

test("response DOM disappearing after it was observed becomes DOM_DRIFT only after grace", () => {
  const now = 200_000;
  const first = deriveCouncilChatGptState(
    { ...base, responsePresent: false },
    { submittedAt: 100_000 },
    { state: "STREAMING", lastAssistantText: "answer", domHealth: { sawResponse: true } },
    now,
    { responseDomGraceMs: 60_000 },
  );
  assert.notEqual(first.state, "DOM_DRIFT");
  const drifted = deriveCouncilChatGptState(
    { ...base, responsePresent: false },
    { submittedAt: 100_000 },
    first,
    now + 60_001,
    { responseDomGraceMs: 60_000 },
  );
  assert.equal(drifted.state, "DOM_DRIFT");
  assert.equal(councilChatGptMayRetry(drifted), false);
  assert.ok(drifted.evidence.includes("response_dom_disappeared"));
});

test("rate limit and waiting-user evidence outrank completion heuristics", () => {
  const limited = deriveCouncilChatGptState(
    { ...base, rateLimited: true, responsePresent: true, assistantText: "partial", completionActionVisible: true },
    {}, {}, 1_000,
  );
  assert.equal(limited.state, "RATE_LIMITED");
  const waiting = deriveCouncilChatGptState(
    { ...base, waitingUser: true, generationRunning: true, stopVisible: true },
    { submittedAt: 500 }, {}, 1_000,
  );
  assert.equal(waiting.state, "WAITING_USER");
});

test("background activity cannot invent a running turn before submission", () => {
  const result = deriveCouncilChatGptState(
    base,
    { activeRequests: 4, lastNetworkActivityAt: 990 },
    {},
    1_000,
  );
  assert.equal(result.state, "IDLE");
});
