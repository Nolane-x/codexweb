import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { CouncilManagedRuntime } from "./managed-runtime";
import { COUNCIL_PERMISSIONS, type ManagedAgentRecord } from "./managed-agent-state";
import { actorSchema, agentIdSchema, assertAgentTokenNotExposed, councilMcpResult, roomIdSchema, type ResolveCouncilActor } from "./mcp-shared";

function publicAgent(agent: ManagedAgentRecord) {
  const { conversationUrl, checkpoint, ...value } = agent;
  return { ...value, conversation_bound: Boolean(conversationUrl), checkpoint_saved: Boolean(checkpoint) };
}

export function registerCouncilManagedTools(server: McpServer, runtime: CouncilManagedRuntime, resolveActor: ResolveCouncilActor): void {
  server.registerTool("council_start_project", {
    title: "Start managed ChatGPT Council project",
    description: "Bootstrap the first authenticated Council participant as the Electron-managed project lead. This succeeds only when no other managed project owns the Electron instance.",
    inputSchema: {
      ...actorSchema,
      room_id: roomIdSchema,
      name: z.string().trim().min(1).max(160),
      mission: z.string().trim().min(1).max(8_000),
      mandate: z.string().trim().min(1).max(4_000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, room_id, name, mission, mandate }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    assertAgentTokenNotExposed(agent_token, [name, mission, mandate]);
    const result = runtime.startProject(actor, { roomId: room_id, name, mission, mandate });
    return councilMcpResult({ project: result.project, lead: publicAgent(result.lead), protocol: "The Electron controller now owns managed child-agent identity, browser surfaces, persistent ChatGPT conversations, wake routing, ACLs, and resurrection." });
  });

  server.registerTool("council_spawn_agent", {
    title: "Spawn managed ChatGPT participant",
    description: "Create a named Electron-managed ChatGPT child participant. The caller may delegate only permissions it already owns; browser identity is bound by Electron, not model text.",
    inputSchema: {
      ...actorSchema,
      name: z.string().trim().min(1).max(120),
      role: z.string().trim().min(1).max(200),
      mandate: z.string().trim().min(1).max(4_000),
      requested_agent_id: agentIdSchema.optional(),
      permissions: z.array(z.enum(COUNCIL_PERMISSIONS)).max(COUNCIL_PERMISSIONS.length).default([]),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ agent_id, agent_token, name, role, mandate, requested_agent_id, permissions }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    assertAgentTokenNotExposed(agent_token, [name, role, mandate]);
    const child = await runtime.spawnAgent(actor, { name, role, mandate, ...(requested_agent_id ? { requestedAgentId: requested_agent_id } : {}), ...(permissions.length > 0 ? { permissions } : {}) });
    return councilMcpResult({ agent: publicAgent(child) });
  });

  server.registerTool("council_bind_repo_workspace", {
    title: "Bind managed Council repository workspace",
    description: "Pin the active managed project to sanitized GitHub repository identity and an immutable base commit for later review/execution safety. This stores metadata only; it does not accept, persist, or grant GitHub credentials, filesystem paths, diffs, or execution capability.",
    inputSchema: {
      ...actorSchema,
      provider: z.literal("github"),
      repo_id: z.string().trim().min(3).max(240),
      owner: z.string().trim().min(1).max(100),
      name: z.string().trim().min(1).max(100),
      default_branch: z.string().trim().min(1).max(255),
      base_commit: z.string().trim().regex(/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token, provider, repo_id, owner, name, default_branch, base_commit }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    assertAgentTokenNotExposed(agent_token, [repo_id, owner, name, default_branch, base_commit]);
    const project = runtime.bindRepoWorkspace(actor, {
      schemaVersion: 1,
      provider,
      repoId: repo_id,
      owner,
      name,
      defaultBranch: default_branch,
      baseCommit: base_commit,
    });
    return councilMcpResult({ project });
  });

  server.registerTool("council_managed_status", {
    title: "Read Electron managed Council status",
    description: "Read the active managed project and safe participant metadata. Persistent conversation URLs and private checkpoints are never returned.",
    inputSchema: { ...actorSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    return councilMcpResult({ actor, project: runtime.activeProject() ?? null, agents: runtime.publicAgents() });
  });
}
