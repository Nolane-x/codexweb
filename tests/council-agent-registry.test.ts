import { describe, expect, test } from "bun:test";
import { CouncilAgentRegistry, MAX_ACTIVE_AGENT_SURFACES } from "../src/council/agent-registry";

describe("CouncilAgentRegistry", () => {
  test("keeps stable source identity and persistent conversation binding", () => {
    const registry = new CouncilAgentRegistry();
    registry.register({ id: "alice", name: "Alice", role: "Architect", mandate: "Design the system" });
    const lease = registry.lease("alice");
    expect(lease.status).toBe("active");
    expect(lease.surfaceId).toBeDefined();
    registry.bindConversation("alice", { surfaceId: lease.surfaceId!, conversationUrl: "https://chatgpt.com/c/alice" });
    expect(registry.get("alice")?.conversationUrl).toBe("https://chatgpt.com/c/alice");
    expect(registry.get("alice")?.surfaceId).toBe(lease.surfaceId);
  });

  test("queues the sixth simultaneously active agent", () => {
    const registry = new CouncilAgentRegistry();
    for (let i = 0; i < MAX_ACTIVE_AGENT_SURFACES + 1; i++) registry.register({ id: `a${i}`, name: `A${i}`, role: "Worker", mandate: "Work" });
    for (let i = 0; i < MAX_ACTIVE_AGENT_SURFACES; i++) expect(registry.lease(`a${i}`).status).toBe("active");
    expect(registry.lease(`a${MAX_ACTIVE_AGENT_SURFACES}`).status).toBe("queued");
  });

  test("rejects binding a conversation to a surface not leased by the agent", () => {
    const registry = new CouncilAgentRegistry();
    registry.register({ id: "alice", name: "Alice", role: "Architect", mandate: "Design" });
    expect(() => registry.bindConversation("alice", { surfaceId: "council-surface-4", conversationUrl: "https://chatgpt.com/c/alice" })).toThrow(/not leased/);
  });
});
