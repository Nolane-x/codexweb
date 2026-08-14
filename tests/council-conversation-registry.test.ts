import { describe, expect, test } from "bun:test";
import { CouncilConversationRegistry } from "../src/council/conversation-registry";

describe("CouncilConversationRegistry", () => {
  test("stores only exact ChatGPT conversation URLs by agent", () => {
    const registry = new CouncilConversationRegistry();
    registry.bind("alice", "https://chatgpt.com/c/abc-123");
    expect(registry.get("alice")).toBe("https://chatgpt.com/c/abc-123");
    expect(() => registry.bind("bob", "https://example.com/c/x")).toThrow(/ChatGPT/);
    expect(() => registry.bind("bob", "https://chatgpt.com/?temporary-chat=true")).toThrow(/conversation/);
  });
});
