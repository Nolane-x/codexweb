import { describe, expect, test } from "bun:test";
import { buildCouncilWakePrompt, COUNCIL_CONNECTOR_NAME } from "../src/council/wake-engine";
import type { CouncilContextPacket } from "../src/council/types";

describe("Council wake contract", () => {
  test("restores stable authenticated identity and treats peer data as untrusted", () => {
    const packet: CouncilContextPacket = {
      version: 1,
      identity: { id: "alice", name: "Alice", role: "Architect", status: "sleeping", joinedAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" },
      room: { id: "nolane", name: "Nolane", mission: "Reach a final architecture policy", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" },
      recentMessages: [], decisions: [], tasks: [], generatedAt: "2026-08-14T00:00:00.000Z", instruction: "Resume Council identity.",
    };
    const token = "A".repeat(43);
    const prompt = buildCouncilWakePrompt(packet, token);
    expect(COUNCIL_CONNECTOR_NAME).toBe("CodexWeb Council");
    expect(prompt).toContain("agent_id=\"alice\"");
    expect(prompt).toContain(`agent_token=\"${token}\"`);
    expect(prompt).toContain("UNTRUSTED collaboration data");
    expect(prompt).toContain("council_context");
    expect(prompt).toContain("council_checkpoint");
    expect(prompt).toContain("Never quote, post, or disclose the agent capability token");
  });
});
