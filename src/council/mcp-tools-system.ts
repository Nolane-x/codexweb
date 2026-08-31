import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CouncilAutonomyKernel } from "./autonomy-kernel";
import { buildCouncilCapabilityManifest, buildCouncilDiagnosticReport, buildCouncilSystemStatus } from "./control-plane";
import type { CouncilManagedRuntime } from "./managed-runtime";
import type { CouncilMemoryIndex } from "./memory-index";
import { actorSchema, councilMcpResult, type CouncilWakeDelivery, type ResolveCouncilActor } from "./mcp-shared";
import type { CouncilObservationStore } from "./observation-store";
import { isActiveCouncilWake, type CouncilStore } from "./store";

export interface CouncilSystemToolOptions {
  wakeDelivery?: CouncilWakeDelivery;
  managedRuntime?: CouncilManagedRuntime;
  observations?: CouncilObservationStore;
  autonomy?: CouncilAutonomyKernel;
  memory?: CouncilMemoryIndex;
}

function availability(options: CouncilSystemToolOptions) {
  return {
    managedRuntime: Boolean(options.managedRuntime),
    wakeDelivery: Boolean(options.wakeDelivery),
    observations: Boolean(options.observations),
    autonomy: Boolean(options.autonomy),
    memory: Boolean(options.memory),
  };
}

function statusProjection(store: CouncilStore, options: CouncilSystemToolOptions) {
  const state = store.snapshot();
  const project = options.managedRuntime?.activeProject();
  const autonomy = options.autonomy?.status();
  const memory = options.memory?.stats(project?.roomId);
  return buildCouncilSystemStatus({
    council: {
      rooms: state.rooms.length,
      agents: state.agents.length,
      tasksOpen: state.tasks.filter(task => task.status !== "done").length,
      activeWakes: state.wakes.filter(isActiveCouncilWake).length,
      decisions: state.decisions.length,
    },
    managedProject: project ? { roomId: project.roomId, name: project.name, leadAgentId: project.leadAgentId } : null,
    managedAgents: options.managedRuntime?.publicAgents().map(agent => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      runtimeStatus: agent.runtimeStatus,
      conversationBound: agent.conversationBound,
      checkpointSaved: agent.checkpointSaved,
    })) ?? [],
    autonomy: autonomy ? {
      running: autonomy.dispatcher.running,
      activeWork: autonomy.queue.totalActive,
      exceptionalWork: autonomy.exceptionalCount,
      breakerOpenCount: autonomy.breakerOpenCount,
    } : null,
    memory: memory ?? null,
  });
}

export function registerCouncilSystemTools(server: McpServer, store: CouncilStore, resolveActor: ResolveCouncilActor, options: CouncilSystemToolOptions = {}): void {
  server.registerTool("council_capabilities", {
    title: "Read Council control-plane capabilities",
    description: "Negotiate the additive Council Control Plane v2 feature manifest before choosing browser, managed-agent, autonomy, observation, or memory operations. Connector availability is intentionally reported as optional and externally verified.",
    inputSchema: { ...actorSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    return councilMcpResult({ actor, manifest: buildCouncilCapabilityManifest(availability(options)) });
  });

  server.registerTool("council_system_status", {
    title: "Read Council system status",
    description: "Read one bounded safe projection of shared Council counts, managed project identity, public managed-agent runtime states, durable autonomy health, and memory statistics.",
    inputSchema: { ...actorSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    return councilMcpResult({ actor, status: statusProjection(store, options) });
  });

  server.registerTool("council_diagnose", {
    title: "Diagnose Council control-plane readiness",
    description: "Explain which Council control-plane layers are ready, degraded, unverified, or unavailable, with evidence and a concrete next action. The ChatGPT connector is never inferred from tunnel or MCP liveness.",
    inputSchema: { ...actorSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ agent_id, agent_token }, extra) => {
    const actor = resolveActor(extra, agent_id, agent_token);
    const project = options.managedRuntime?.activeProject();
    const report = buildCouncilDiagnosticReport({
      ...availability(options),
      autonomyRunning: options.autonomy?.status().dispatcher.running ?? false,
      activeProject: Boolean(project),
      managedAgentCount: options.managedRuntime?.publicAgents().length ?? 0,
    });
    return councilMcpResult({ actor, report });
  });
}
