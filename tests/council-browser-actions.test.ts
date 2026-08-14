import { describe, expect, test } from "bun:test";
import { parseCouncilActionFooter } from "../src/council/browser-action-parser";
import { applyCouncilActionBatch } from "../src/council/browser-action-transaction";

describe("browser Council action protocol", () => {
  test("parses one terminal Council block and strips it from visible text", () => {
    const parsed = parseCouncilActionFooter('Answer\n<COUNCIL_ACTIONS version="1">\n{"actions":[{"type":"WAKE","target_agent_id":"bob","room_id":"core","reason":"Review"}]}\n</COUNCIL_ACTIONS>');
    expect(parsed.visibleText).toBe("Answer");
    expect(parsed.batch.actions[0]?.type).toBe("WAKE");
  });

  test("rejects malformed, non-terminal and source-identity fields", () => {
    expect(() => parseCouncilActionFooter('<COUNCIL_ACTIONS version="1">{bad}</COUNCIL_ACTIONS>')).toThrow();
    expect(() => parseCouncilActionFooter('<COUNCIL_ACTIONS version="1">{"actions":[]}</COUNCIL_ACTIONS> trailing')).toThrow();
    expect(() => parseCouncilActionFooter('<COUNCIL_ACTIONS version="1">{"actions":[{"type":"SAY","room_id":"core","body":"hi","agent_id":"bob"}]}</COUNCIL_ACTIONS>')).toThrow(/unknown field/);
    expect(() => parseCouncilActionFooter('<COUNCIL_ACTIONS version="1">{"actions":[{"type":"SAY","room_id":"core","body":"hi","command":"rm -rf"}]}</COUNCIL_ACTIONS>')).toThrow(/unknown field/);
  });

  test("commits only after every action stages successfully", () => {
    let committed: { log: string[] } | null = null;
    const adapter = {
      snapshot: () => ({ log: [] as string[] }),
      applyToDraft: (draft: { log: string[] }, source: string, action: { type: string; body?: string }) => {
        if (action.body === "bad") throw new Error("bad action");
        draft.log.push(`${source}:${action.type}`);
        return [];
      },
      commit: (draft: { log: string[] }) => { committed = structuredClone(draft); },
    };
    expect(() => applyCouncilActionBatch("alice", { version: 1, actions: [
      { type: "SAY", room_id: "core", body: "ok" },
      { type: "SAY", room_id: "core", body: "bad" },
    ] }, adapter)).toThrow(/bad action/);
    expect(committed).toBeNull();
  });
});
