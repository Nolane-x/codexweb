import test from "node:test";
import assert from "node:assert/strict";
import { evaluateIndependentCritiqueGate } from "../src/council/decision-critique";

const proposal = (id: string, author: string, threadId = id) => ({ id, roomId: "core", authorAgentId: author, kind: "proposal", threadId });
const reply = (id: string, author: string, threadId: string, replyTo: string) => ({ id, roomId: "core", authorAgentId: author, kind: "message", threadId, replyTo });

test("single-participant proposal does not manufacture a critique requirement", () => {
  const result = evaluateIndependentCritiqueGate({ messages: [proposal("p1", "alice")], tasks: [], wakes: [] }, "core");
  assert.equal(result.required, false);
  assert.equal(result.satisfied, true);
});

test("a second participant involved through task or wake requires independent critique on latest proposal", () => {
  const base = {
    messages: [proposal("p1", "alice"), reply("r1", "bob", "p1", "p1"), proposal("p2", "alice")],
    tasks: [{ roomId: "core", createdByAgentId: "alice", assigneeAgentId: "bob" }],
    wakes: [],
  };
  let result = evaluateIndependentCritiqueGate(base, "core");
  assert.equal(result.required, true);
  assert.equal(result.satisfied, false);
  assert.match(result.reason ?? "", /latest proposal/i);
  result = evaluateIndependentCritiqueGate({ ...base, messages: [...base.messages, reply("r2", "bob", "p2", "p2")] }, "core");
  assert.equal(result.satisfied, true);
});

test("proposal author cannot satisfy independent critique by replying to self", () => {
  const result = evaluateIndependentCritiqueGate({
    messages: [proposal("p1", "alice"), reply("r1", "alice", "p1", "p1")],
    tasks: [{ roomId: "core", createdByAgentId: "alice", assigneeAgentId: "bob" }],
    wakes: [],
  }, "core");
  assert.equal(result.required, true);
  assert.equal(result.satisfied, false);
});
