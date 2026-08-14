import { describe, expect, test } from "bun:test";
import { COUNCIL_MCP_SERVER_NAME, COUNCIL_TOOL_NAMES } from "../src/council/mcp-server";
import { actorSchema } from "../src/council/mcp-shared";

describe("Council MCP contract", () => {
  test("exposes collaboration, decision, task, wake and continuity tools", () => { expect(COUNCIL_MCP_SERVER_NAME).toBe("codexweb-council"); for (const name of ["council_join", "council_say", "council_decide", "council_task_create", "council_wake", "council_context"]) expect(COUNCIL_TOOL_NAMES).toContain(name as never); });
  test("does not expose legacy Codex broker tools", () => { expect(COUNCIL_TOOL_NAMES.some(name => name.startsWith("codex_"))).toBe(false); });
  test("requires explicit actor identity on every non-join Council call", () => { expect(actorSchema.agent_id.safeParse(undefined).success).toBe(false); expect(actorSchema.agent_id.safeParse("alice").success).toBe(true); });
});
