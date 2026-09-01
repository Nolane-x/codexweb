import { describe, expect, test } from "bun:test";
import { COUNCIL_MCP_SERVER_NAME, COUNCIL_MCP_SERVER_VERSION, COUNCIL_TOOL_NAMES } from "../src/council/mcp-server";
import { actorSchema } from "../src/council/mcp-shared";

describe("Council MCP contract", () => {
  test("exposes collaboration, managed-agent, repo-binding, continuity, observation, autonomy, memory and execution tools", () => {
    expect(COUNCIL_MCP_SERVER_NAME).toBe("codexweb-council");
    expect(COUNCIL_MCP_SERVER_VERSION).toBe("1.8.0");
    for (const name of [
      "council_join",
      "council_say",
      "council_propose",
      "council_reply",
      "council_decide",
      "council_task_create",
      "council_wake",
      "council_context",
      "council_start_project",
      "council_spawn_agent",
      "council_bind_repo_workspace",
      "council_managed_status",
      "council_observation_list",
      "council_observation_read",
      "council_autonomy_status",
      "council_autonomy_audit",
      "council_memory_search",
      "council_memory_recent",
      "council_capabilities",
      "council_system_status",
      "council_diagnose",
      "council_agent_list",
      "council_room_list",
      "council_task_list",
      "council_task_read",
      "council_decision_list",
      "council_decision_read",
      "council_wake_list",
      "council_agent_health",
      "council_exceptional_work",
      "council_memory_stats",
      "council_execution_list",
      "council_execution_read",
      "council_execution_events",
      "council_execution_receipts",
      "council_execution_cancel",
      "council_execution_focus",
      "council_execution_capture",
      "council_execution_retry",
    ]) expect(COUNCIL_TOOL_NAMES).toContain(name as never);
    expect(new Set(COUNCIL_TOOL_NAMES).size).toBe(COUNCIL_TOOL_NAMES.length);
  });
  test("does not expose legacy Codex broker or raw browser mutation tools", () => {
    expect(COUNCIL_TOOL_NAMES.some(name => name.startsWith("codex_"))).toBe(false);
    expect(COUNCIL_TOOL_NAMES.some(name => /clear_memory|selector|javascript|cdp|raw_browser/i.test(name))).toBe(false);
  });
  test("requires explicit actor identity and private capability on every non-join Council call", () => {
    expect(actorSchema.agent_id.safeParse(undefined).success).toBe(false);
    expect(actorSchema.agent_id.safeParse("alice").success).toBe(true);
    expect(actorSchema.agent_token.safeParse(undefined).success).toBe(false);
    expect(actorSchema.agent_token.safeParse("short").success).toBe(false);
    expect(actorSchema.agent_token.safeParse("A".repeat(43)).success).toBe(true);
  });
});
