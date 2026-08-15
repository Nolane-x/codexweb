import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "../version";
import type { CouncilAutonomyKernel } from "./autonomy-kernel";
import { assertCouncilDecisionGate } from "./decision-gate";
import type { CouncilManagedRuntime } from "./managed-runtime";
import { COUNCIL_PERMISSIONS } from "./managed-agent-state";
import { registerCouncilAutonomyTools } from "./mcp-tools-autonomy";
import { registerCouncilObservationTools } from "./mcp-tools-observations";
import type { CouncilObservationStore } from "./observation-store";
import { assertCouncilAgentToken } from "./participant-auth";
import type { RepoWorkspaceBinding } from "./repo-workspace";
import { coerceCouncilWakeStatus } from "./work-operations";
import type { CouncilStore } from "./store";
import type { CouncilWakeDelivery } from "./wake-delivery";

const agentId = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const roomId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const messageId = z.string().trim().min(1).max(160);
const taskId = z.string().trim().min(1).max(160);
const token = z.string().trim().min(32).max(256);
const shortText = z.string().trim().min(1).max(160);
const bodyText = z.string().trim().min(1).max(12_000);
const optionalStringArray = z.array(z.string().trim().min(1).max(500)).max(24).optional();
const taskStatus = z.enum(["todo", "claimed", "in_progress", "review", "done", "blocked"]);
const permission = z.enum(COUNCIL_PERMISSIONS);
const repoBindingSchema = {
  provider: z.literal("github"),
  repository: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  default_branch: z.string().trim().min(1).max(160),
  base_sha: z.string().trim().min(7).max(64).regex(/^[0-9a-f]+$/i),
  execution_branch: z.string().trim().min(1).max(200),
  integration_mode: z.enum(["pull_request", "direct_push"]),
};

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

export async function runCouncilMcpServer(options: {
  store: CouncilStore;
  wakeDelivery?: CouncilWakeDelivery;
  managedRuntime?: CouncilManagedRuntime;
  observations?: CouncilObservationStore;
  autonomy?: CouncilAutonomyKernel;
}): Promise<void> {
  const { store, wakeDelivery, managedRuntime, observations, autonomy } = options;
  const server = new McpServer({ name: "codexweb-council", version: VERSION });
  const authenticatedAgent = (id: string, value: string) => assertCouncilAgentToken(store.snapshot(), id, value).agent;

  server.registerTool("council_join", {
    description: "Register a stable Council participant, or securely resume a known participant by presenting its private agent_token. New joins return the token once; keep it private and use it for all later Council calls.",
    inputSchema: { agent_id: agentId, name: shortText, role: shortText, agent_token: token.optional() },
  }, async ({ agent_id, name, role, agent_token }) => jsonResult(store.joinAgent({ id: agent_id, name, role, status: "awake", agentToken: agent_token })));

  server.registerTool("council_room_upsert", {
    description: "Create or update a shared deliberation room's name and mission. Managed participants need reopen permission for policy changes.",
    inputSchema: { agent_id: agentId, agent_token: token, room_id: roomId, name: shortText, mission: z.string().trim().min(1).max(500) },
  }, async ({ agent_id, agent_token, room_id, name, mission }) => {
    authenticatedAgent(agent_id, agent_token);
    managedRuntime?.authorizeManaged(agent_id, "reopen");
    return jsonResult(store.ensureRoom({ id: room_id, name, mission }));
  });

  server.registerTool("council_status", {
    description: "Read compact shared Council state: participants, rooms, recent decisions, active tasks and pending wake events.",
    inputSchema: { agent_id: agentId, agent_token: token },
  }, async ({ agent_id, agent_token }) => {
    authenticatedAgent(agent_id, agent_token);
    const snapshot = store.snapshot();
    const presence = new Map(store.presenceSnapshot().map(item => [item.agentId, item]));
    return jsonResult({
      agents: snapshot.agents.map(agent => ({ ...agent, presence: presence.get(agent.id) })),
      rooms: snapshot.rooms,
      decisions: snapshot.decisions.slice(-20),
      tasks: snapshot.tasks.filter(task => task.status !== "done").slice(-50),
      wakes: snapshot.wakes.filter(wake => ["queued", "dispatched", "target-running"].includes(wake.status)).slice(-50),
    });
  });

  server.registerTool("council_read", {
    description: "Read recent shared-room messages in chronological order.",
    inputSchema: { agent_id: agentId, agent_token: token, room_id: roomId, limit: z.number().int().min(1).max(200).optional() },
  }, async ({ agent_id, agent_token, room_id, limit }) => {
    authenticatedAgent(agent_id, agent_token);
    return jsonResult(store.readRoom(room_id, limit ?? 50));
  });

  server.registerTool("council_say", {
    description: "Post a normal or system message into a shared Council room. Optional mentions and thread_id preserve directed collaboration.",
    inputSchema: { agent_id: agentId, agent_token: token, room_id: roomId, body: bodyText, kind: z.enum(["message", "system"]).optional(), mentions: z.array(agentId).max(24).optional(), thread_id: messageId.optional() },
  }, async ({ agent_id, agent_token, room_id, body, kind, mentions, thread_id }) => {
    authenticatedAgent(agent_id, agent_token);
    return jsonResult(store.say({ roomId: room_id, authorAgentId: agent_id, body, kind: kind ?? "message", mentions, threadId: thread_id }));
  });

  server.registerTool("council_propose", {
    description: "Publish a concrete proposal as a first-class Council message/thread for other participants to challenge before a decision.",
    inputSchema: { agent_id: agentId, agent_token: token, room_id: roomId, body: bodyText, mentions: z.array(agentId).max(24).optional() },
  }, async ({ agent_id, agent_token, room_id, body, mentions }) => {
    authenticatedAgent(agent_id, agent_token);
    return jsonResult(store.say({ roomId: room_id, authorAgentId: agent_id, body, kind: "proposal", mentions }));
  });

  server.registerTool("council_reply", {
    description: "Reply to an existing Council message/proposal while preserving its discussion thread.",
    inputSchema: { agent_id: agentId, agent_token: token, room_id: roomId, reply_to: messageId, body: bodyText, mentions: z.array(agentId).max(24).optional() },
  }, async ({ agent_id, agent_token, room_id, reply_to, body, mentions }) => {
    authenticatedAgent(agent_id, agent_token);
    return jsonResult(store.say({ roomId: room_id, authorAgentId: agent_id, body, kind: "message", replyTo: reply_to, mentions }));
  });

  server.registerTool("council_checkpoint", {
    description: "Save compact private task state for this agent so a later wake can restore continuity without replaying the full transcript. Managed-agent memory is also mirrored into private Electron continuity state.",
    inputSchema: { agent_id: agentId, agent_token: token, room_id: roomId.optional(), summary: z.string().trim().min(1).max(8_000) },
  }, async ({ agent_id, agent_token, room_id, summary }) => {
    authenticatedAgent(agent_id, agent_token);
    const checkpoint = store.checkpoint({ agentId: agent_id, roomId: room_id, summary });
    managedRuntime?.saveManagedCheckpoint(agent_id, summary);
    return jsonResult(checkpoint);
  });

  server.registerTool("council_context", {
    description: "Build a bounded resurrection packet from shared state, recent discussion and this agent's private checkpoint.",
    inputSchema: { agent_id: agentId, agent_token: token, room_id: roomId, wake_id: messageId.optional(), recent_limit: z.number().int().min(1).max(100).optional() },
  }, async ({ agent_id, agent_token, room_id, wake_id, recent_limit }) => {
    authenticatedAgent(agent_id, agent_token);
    return jsonResult(store.buildContextPacket({ agentId: agent_id, roomId: room_id, wakeId: wake_id, recentLimit: recent_limit }));
  });

  server.registerTool("council_agent_status", {
    description: "Mark this participant awake, sleeping, or offline.",
    inputSchema: { agent_id: agentId, agent_token: token, status: z.enum(["awake", "sleeping", "offline"]) },
  }, async ({ agent_id, agent_token, status }) => {
    authenticatedAgent(agent_id, agent_token);
    return jsonResult(store.updateAgentStatus(agent_id, status));
  });

  server.registerTool("council_decide", {
    description: "Record a deliberated Council policy with rationale, accepted/rejected arguments and unresolved risks. Managed participants require finalize permission and a ready decision gate.",
    inputSchema: {
      agent_id: agentId,
      agent_token: token,
      room_id: roomId,
      title: shortText,
      policy: z.string().trim().min(1).max(4_000),
      rationale: z.string().trim().min(1).max(6_000),
      accepted_arguments: optionalStringArray,
      rejected_arguments: optionalStringArray,
      unresolved_risks: optionalStringArray,
    },
  }, async ({ agent_id, agent_token, room_id, title, policy, rationale, accepted_arguments, rejected_arguments, unresolved_risks }) => {
    authenticatedAgent(agent_id, agent_token);
    if (managedRuntime) managedRuntime.authorizeManagedDecision(agent_id, room_id);
    else assertCouncilDecisionGate(store.snapshot(), room_id);
    return jsonResult(store.decide({ roomId: room_id, createdByAgentId: agent_id, title, policy, rationale, acceptedArguments: accepted_arguments, rejectedArguments: rejected_arguments, unresolvedRisks: unresolved_risks }));
  });

  server.registerTool("council_task_create", {
    description: "Create a concrete Council task from deliberation, optionally assigning it to a named participant. Managed participants require assign permission.",
    inputSchema: { agent_id: agentId, agent_token: token, room_id: roomId, title: shortText, description: z.string().trim().min(1).max(8_000), assignee_agent_id: agentId.optional() },
  }, async ({ agent_id, agent_token, room_id, title, description, assignee_agent_id }) => {
    authenticatedAgent(agent_id, agent_token);
    if (assignee_agent_id !== undefined) managedRuntime?.authorizeManaged(agent_id, "assign");
    return jsonResult(store.createTask({ roomId: room_id, createdByAgentId: agent_id, title, description, assigneeAgentId: assignee_agent_id }));
  });

  server.registerTool("council_task_update", {
    description: "Advance a Council task through todo, claimed, in_progress, review, done, or blocked. Managed participants can advance their own assignment; reassignment requires assign permission.",
    inputSchema: { agent_id: agentId, agent_token: token, task_id: taskId, status: taskStatus, assignee_agent_id: agentId.optional() },
  }, async ({ agent_id, agent_token, task_id, status, assignee_agent_id }) => {
    authenticatedAgent(agent_id, agent_token);
    managedRuntime?.authorizeManagedTaskUpdate(agent_id, task_id, assignee_agent_id);
    return jsonResult(store.updateTask({ taskId: task_id, actorAgentId: agent_id, status, assigneeAgentId: assignee_agent_id }));
  });

  server.registerTool("council_wake", {
    description: "Durably target another named participant and schedule its managed ChatGPT Web resurrection turn when the wake engine is available. Managed participants require wake permission. The caller receives only a wake receipt; target private checkpoint/context is never returned.",
    inputSchema: { agent_id: agentId, agent_token: token, target_agent_id: agentId, room_id: roomId, reason: z.string().trim().min(1).max(1_000), source_message_id: messageId.optional() },
  }, async ({ agent_id, agent_token, target_agent_id, room_id, reason, source_message_id }) => {
    authenticatedAgent(agent_id, agent_token);
    managedRuntime?.authorizeManaged(agent_id, "wake");
    const wake = store.wake({ targetAgentId: target_agent_id, sourceAgentId: agent_id, roomId: room_id, reason, sourceMessageId: source_message_id });
    let delivered = false;
    let deliveryError: string | undefined;
    try { delivered = Boolean(await wakeDelivery?.deliver(wake)); }
    catch (error) { deliveryError = error instanceof Error ? error.message : String(error); }
    const fresh = store.snapshot().wakes.find(candidate => candidate.id === wake.id) ?? wake;
    return jsonResult({ wakeId: fresh.id, targetAgentId: fresh.targetAgentId, roomId: fresh.roomId, status: coerceCouncilWakeStatus(fresh.status), createdAt: fresh.createdAt, updatedAt: fresh.updatedAt, deliveryAccepted: delivered, ...(deliveryError ? { deliveryError } : {}) });
  });

  server.registerTool("council_start_project", {
    description: "Bootstrap the first authenticated Council participant as the Electron-managed project Lead when no existing managed project owns this Electron instance.",
    inputSchema: { agent_id: agentId, agent_token: token, room_id: roomId, name: shortText, mission: z.string().trim().min(1).max(500), mandate: z.string().trim().min(1).max(2_000) },
  }, async ({ agent_id, agent_token, room_id, name, mission, mandate }) => {
    authenticatedAgent(agent_id, agent_token);
    if (!managedRuntime) throw new Error("Managed ChatGPT runtime is unavailable");
    return jsonResult(managedRuntime.startProject(agent_id, { roomId: room_id, name, mission, mandate }));
  });

  server.registerTool("council_spawn_agent", {
    description: "Create a named Electron-managed ChatGPT child participant. The caller can delegate only permissions it owns; browser identity is bound by Electron, not model text.",
    inputSchema: { agent_id: agentId, agent_token: token, name: shortText, role: shortText, mandate: z.string().trim().min(1).max(2_000), requested_agent_id: agentId.optional(), permissions: z.array(permission).max(COUNCIL_PERMISSIONS.length).optional() },
  }, async ({ agent_id, agent_token, name, role, mandate, requested_agent_id, permissions }) => {
    authenticatedAgent(agent_id, agent_token);
    if (!managedRuntime) throw new Error("Managed ChatGPT runtime is unavailable");
    managedRuntime.authorizeManaged(agent_id, "spawn");
    return jsonResult(await managedRuntime.spawnAgent(agent_id, { name, role, mandate, requestedAgentId: requested_agent_id, permissions }));
  });

  server.registerTool("council_repo_bind", {
    description: "Bind one exact GitHub repository/base SHA/execution branch to the active managed Council project. Only the managed Lead can change this execution boundary.",
    inputSchema: { agent_id: agentId, agent_token: token, ...repoBindingSchema },
  }, async ({ agent_id, agent_token, provider, repository, default_branch, base_sha, execution_branch, integration_mode }) => {
    authenticatedAgent(agent_id, agent_token);
    if (!managedRuntime) throw new Error("Managed ChatGPT runtime is unavailable");
    const binding: RepoWorkspaceBinding = { provider, repository, defaultBranch: default_branch, baseSha: base_sha, executionBranch: execution_branch, integrationMode: integration_mode };
    return jsonResult(managedRuntime.bindRepoWorkspace(agent_id, binding));
  });

  server.registerTool("council_managed_status", {
    description: "Read the active managed project and safe participant metadata. Persistent conversation URLs and private checkpoints are never returned.",
    inputSchema: { agent_id: agentId, agent_token: token },
  }, async ({ agent_id, agent_token }) => {
    authenticatedAgent(agent_id, agent_token);
    if (!managedRuntime) return jsonResult({ project: null, agents: [] });
    return jsonResult({ project: managedRuntime.activeProject() ?? null, agents: managedRuntime.publicAgents() });
  });

  if (observations) registerCouncilObservationTools(server, observations);
  if (autonomy) registerCouncilAutonomyTools(server, autonomy);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
