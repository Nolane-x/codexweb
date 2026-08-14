import { describe, expect, test } from "bun:test";
import { registerCouncilManagedTools } from "../src/council/mcp-tools-managed";

type ToolHandler = (input: any, extra: unknown) => Promise<any> | any;

function captureManagedTools(runtime: any): Map<string, { definition: any; handler: ToolHandler }> {
  const handlers = new Map<string, { definition: any; handler: ToolHandler }>();
  const server = {
    registerTool(name: string, definition: any, handler: ToolHandler) {
      handlers.set(name, { definition, handler });
    },
  };
  registerCouncilManagedTools(server as any, runtime, (_extra, explicit) => explicit!);
  return handlers;
}

describe("managed Council MCP repository binding", () => {
  test("passes only sanitized repository identity/base metadata to the Lead-owned runtime boundary", async () => {
    const calls: any[] = [];
    const runtime = {
      bindRepoWorkspace(actor: string, input: unknown) {
        calls.push({ actor, input });
        return { roomId: "project", leadAgentId: actor, workspace: input };
      },
    };
    const tool = captureManagedTools(runtime).get("council_bind_repo_workspace");
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      agent_id: "alice",
      agent_token: "A".repeat(43),
      provider: "github",
      repo_id: "Nolane-x/codexweb",
      owner: "Nolane-x",
      name: "codexweb",
      default_branch: "main",
      base_commit: "48a596a4fb0caa177ea2967e5c96bbb0c0aec7c3",
      github_token: "must-never-cross-runtime-boundary",
      local_path: "C:\\secret\\checkout",
    }, {});

    expect(calls).toEqual([{
      actor: "alice",
      input: {
        schemaVersion: 1,
        provider: "github",
        repoId: "Nolane-x/codexweb",
        owner: "Nolane-x",
        name: "codexweb",
        defaultBranch: "main",
        baseCommit: "48a596a4fb0caa177ea2967e5c96bbb0c0aec7c3",
      },
    }]);
    expect(result.structuredContent.project.workspace).toEqual(calls[0].input);
  });
});
