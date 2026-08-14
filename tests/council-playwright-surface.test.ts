import { describe, expect, test } from "bun:test";
import { classifyConversationSurface } from "../src/council/playwright-council-surface";

describe("persistent ChatGPT surface classification", () => {
  test("accepts exact ChatGPT conversation surface", () => {
    expect(classifyConversationSurface("https://chatgpt.com/c/abc", "https://chatgpt.com/c/abc", "")).toBe("available");
  });
  test("treats root redirect or explicit missing text as unavailable", () => {
    expect(classifyConversationSurface("https://chatgpt.com/c/abc", "https://chatgpt.com/", "")).toBe("unavailable");
    expect(classifyConversationSurface("https://chatgpt.com/c/abc", "https://chatgpt.com/c/abc", "Conversation not found")).toBe("unavailable");
  });
  test("treats about:blank as a recoverable surface failure rather than a missing conversation", () => {
    expect(classifyConversationSurface("https://chatgpt.com/c/abc", "about:blank", "")).toBe("surface-unavailable");
  });
  test("treats unexpected origin as invalid rather than resurrecting", () => {
    expect(classifyConversationSurface("https://chatgpt.com/c/abc", "https://evil.example/c/abc", "")).toBe("invalid");
  });
});
