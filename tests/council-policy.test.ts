import { describe, expect, test } from "bun:test";
import { assertBrowserActionPermission } from "../src/council/policy";

const chair = { id: "alice", permissions: ["spawn", "wake", "finalize", "assign"] } as const;
const critic = { id: "critic", permissions: ["wake", "review"] } as const;

describe("managed Council ACL", () => {
  test("final decision requires finalize permission", () => {
    expect(() => assertBrowserActionPermission(chair as never, { type: "FINAL_DECISION" } as never)).not.toThrow();
    expect(() => assertBrowserActionPermission(critic as never, { type: "FINAL_DECISION" } as never)).toThrow(/finalize/);
  });
  test("spawn and assignment require explicit permissions", () => {
    expect(() => assertBrowserActionPermission(critic as never, { type: "SPAWN_AGENT" } as never)).toThrow(/spawn/);
    expect(() => assertBrowserActionPermission(critic as never, { type: "CREATE_TASK" } as never)).toThrow(/assign/);
  });
  test("ordinary discussion is permitted without admin capabilities", () => {
    for (const type of ["SAY", "PROPOSE", "REPLY", "CHECKPOINT", "SLEEP"] as const) {
      expect(() => assertBrowserActionPermission(critic as never, { type } as never)).not.toThrow();
    }
  });
});
