import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { getConfigDir, loadConfig } from "../config";
import { CouncilAgentRegistry } from "./agent-registry";
import { CouncilAutonomyKernel } from "./autonomy-kernel";
import { CouncilBrowserTransport } from "./browser-transport";
import { parseCouncilActionFooter } from "./browser-action-parser";
import { CouncilEvidenceStore } from "./evidence-store";
import { HybridCouncilWakeDelivery } from "./hybrid-wake-delivery";
import { startCouncilHttpServer } from "./http-server";
import { createLauncherPersistentTurnControl } from "./launcher-turn-control";
import { ManagedAgentStateStore } from "./managed-agent-state";
import { ManagedProjectStateStore } from "./managed-project-state";
import { CouncilManagedRuntime } from "./managed-runtime";
import { CouncilMemoryIndex } from "./memory-index";
import { CouncilMemoryProjector } from "./memory-projector";
import { runCouncilMcpServer } from "./mcp-server";
import { CouncilObservationStore } from "./observation-store";
import { issueCouncilOwnerControl } from "./owner-control";
import { PlaywrightCouncilChatDriver } from "./playwright-council-driver";
import { CouncilStaleWorkMonitor } from "./stale-work-monitor";
import { CouncilStore } from "./store";
import { CouncilSupervisor } from "./supervisor";
import { CouncilWakeEngine } from "./wake-engine";

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}
function projectName(value: string): string { const normalized = value.trim(); return normalized ? normalized.slice(0, 160) : "ChatGPT Project"; }

export async function runCouncilMcpMain(args: string[]): Promise<void> {
  const remaining = [...args];
  const storePath = takeOption(remaining, "--store") ?? join(getConfigDir(), "council", "state.json");
  takeOption(remaining, "--broker-socket");
  if (remaining.length > 0) throw new Error(`Unknown Council MCP arguments: ${remaining.join(" ")}`);

  const store = new CouncilStore(storePath);
  const councilDir = dirname(storePath);
  const ownerDescriptorPath = join(councilDir, "owner-control.json");
  let managedRuntime: CouncilManagedRuntime | undefined;
  let managedState: ManagedAgentStateStore | undefined;
  let fallbackWake: CouncilWakeEngine | undefined;
  let evidence: CouncilEvidenceStore | undefined;
  let memory: CouncilMemoryIndex | undefined;
  let observations: CouncilObservationStore | undefined;
  let supervisor: CouncilSupervisor | undefined;
  let autonomy: CouncilAutonomyKernel | undefined;
  let memoryProjector: CouncilMemoryProjector | undefined;
  let staleMonitor: CouncilStaleWorkMonitor | undefined;
  try {
    const config = loadConfig();
    if (config.browserHost === "launcher" && config.browserHostDescriptorPath) {
      const control = createLauncherPersistentTurnControl(config.browserHostDescriptorPath);
      const transport = new CouncilBrowserTransport(control, new PlaywrightCouncilChatDriver(config.browserHostDescriptorPath));
      managedState = new ManagedAgentStateStore(join(councilDir, "managed-agents.json"));
      managedRuntime = new CouncilManagedRuntime({
        council: store,
        managed: managedState,
        project: new ManagedProjectStateStore(join(councilDir, "managed-project.json")),
        registry: new CouncilAgentRegistry(),
        transport,
        parseAnswer: parseCouncilActionFooter,
      });
      evidence = new CouncilEvidenceStore(join(councilDir, "evidence"));
      memory = new CouncilMemoryIndex(join(councilDir, "memory-index.json"));
      observations = new CouncilObservationStore(join(councilDir, "observations"), { evidence });
      supervisor = new CouncilSupervisor({
        runtime: managedRuntime,
        council: store,
        observations,
        statePath: join(councilDir, "supervisor.json"),
      });
      autonomy = new CouncilAutonomyKernel({ rootDir: councilDir, council: store, runtime: managedRuntime, supervisor, memory });
      memoryProjector = new CouncilMemoryProjector({ council: store, observations, memory, autonomy });
      staleMonitor = new CouncilStaleWorkMonitor({
        council: store,
        managedAgentIds: () => new Set(managedRuntime!.supervisorAgents().map(agent => agent.id)),
        managedStatus: agentId => managedRuntime!.managedStatus(agentId),
        managerAgentId: () => supervisor!.status().managerAgentId,
        enqueueEscalation: input => { autonomy!.enqueueStaleTaskEscalation(input); },
      });
    }
    if (config.mode === "full") fallbackWake = new CouncilWakeEngine(store, config);
  } catch (error) {
    console.info(`[council-runtime] managed browser transport unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  let ownerToken: string | undefined;
  const httpServer = startCouncilHttpServer(store, {
    onError: message => console.error(`[council-http] ${message}`),
    ...(managedRuntime ? {
      managedSnapshot: () => ({
        project: managedRuntime!.activeProject() ?? null,
        agents: managedRuntime!.publicAgents(),
        ...(autonomy ? { autonomy: autonomy.status() } : {}),
      }),
      owner: {
        token: () => ownerToken,
        startLead: async input => {
          if (!managedRuntime || !managedState) throw new Error("Managed ChatGPT browser transport is unavailable");
          const name = projectName(input.projectName);
          let project = managedRuntime.activeProject();
          let leadId = project?.leadAgentId;
          if (!project) {
            const participants = [...store.snapshot().agents].sort((left, right) => left.joinedAt.localeCompare(right.joinedAt) || left.id.localeCompare(right.id));
            const actor = participants[0] ?? store.joinAgent({ id: "lead", name: "Lead", role: "Lead Coordinator", status: "awake" }).agent;
            const started = managedRuntime.startProject(actor.id, {
              roomId: "project",
              name,
              mission: `Coordinate ${name}. Build a specialist ChatGPT team when useful, require independent critique before final policy, then assign and review work.`,
              mandate: "Lead the Council, create the smallest useful specialist team, synthesize disagreements, finalize policy only after critique, and assign verified work.",
            });
            project = started.project;
            leadId = started.lead.id;
          }
          if (!project || !leadId) throw new Error("Council project lead could not be initialized");
          const bound = managedState.bindConversation(leadId, input.conversationUrl);
          const wake = store.wake({
            targetAgentId: leadId,
            roomId: project.roomId,
            reason: "This ChatGPT conversation was bound as the Council Lead. Continue from the existing human/project context. Establish the project plan, create specialist agents only when useful, request independent critique, then coordinate execution through Council actions.",
          });
          const delivered = await managedRuntime.deliverWakeEvent(wake);
          if (!delivered) throw new Error("Council Lead wake could not be delivered to the persistent ChatGPT conversation");
          return {
            project: { roomId: project.roomId, name: project.name, mission: project.mission, leadAgentId: project.leadAgentId },
            lead: { id: bound.id, name: bound.name, role: bound.role, conversationBound: true },
            wakeId: wake.id,
          };
        },
        ...(supervisor ? {
          supervisor: {
            status: () => supervisor!.status(),
            setManager: (agentId?: string) => supervisor!.setManager(agentId),
            runNow: () => supervisor!.requestRun(),
            history: () => supervisor!.history(),
            observation: (runId: string) => supervisor!.observation(runId),
            screenshot: (runId: string, screenshotId: string) => supervisor!.screenshot(runId, screenshotId),
            deleteObservation: (runId: string) => {
              const deleted = supervisor!.deleteObservation(runId);
              if (deleted) memoryProjector?.scan();
              return deleted;
            },
            clearHistory: () => {
              const deleted = supervisor!.clearHistory();
              if (deleted) memoryProjector?.scan();
              return deleted;
            },
            storageStats: () => observations?.evidenceStats() ?? null,
          },
        } : {}),
        ...(autonomy ? {
          autonomy: {
            status: () => autonomy!.status(),
            exceptional: () => autonomy!.exceptionalWork(),
            cancelExceptional: (workItemId: string) => autonomy!.operatorCancelExceptional(workItemId),
            retryUncertain: (workItemId: string) => autonomy!.operatorRetryUncertainAsNew(workItemId),
          },
        } : {}),
        ...(memory ? {
          memory: {
            stats: (projectRoomId?: string) => memory!.stats(projectRoomId),
            search: (input: { projectRoomId: string; query: string; limit: number }) => memory!.search(input),
            recent: (input: { projectRoomId: string; limit: number }) => memory!.recent(input),
            clearProject: (projectRoomId: string) => memory!.clearProject(projectRoomId),
          },
        } : {}),
      },
    } : {}),
  });

  if (managedRuntime && !httpServer) {
    throw new Error("Council owner-control service could not bind 127.0.0.1:17842; close the conflicting local process and reconnect the Tunnel");
  }
  if (httpServer && managedRuntime) {
    try {
      const ownerPort = httpServer.port;
      if (typeof ownerPort !== "number" || !Number.isInteger(ownerPort)) throw new Error("Council owner server did not expose a valid loopback port");
      const descriptor = issueCouncilOwnerControl(ownerDescriptorPath, ownerPort);
      ownerToken = descriptor.token;
      autonomy?.start();
      memoryProjector?.start();
      staleMonitor?.start();
      supervisor?.start();
    } catch (error) {
      httpServer.stop(true);
      throw error;
    }
  }

  const wakeDelivery = managedRuntime || fallbackWake ? new HybridCouncilWakeDelivery(store, managedRuntime, fallbackWake) : undefined;
  try {
    await runCouncilMcpServer({
      store,
      ...(wakeDelivery ? { wakeDelivery } : {}),
      ...(managedRuntime ? { managedRuntime } : {}),
      ...(observations ? { observations } : {}),
      ...(autonomy ? { autonomy } : {}),
      ...(memory ? { memory } : {}),
    });
  } finally {
    staleMonitor?.stop();
    memoryProjector?.stop();
    supervisor?.stop();
    await autonomy?.stop().catch(() => {});
    ownerToken = undefined;
    rmSync(ownerDescriptorPath, { force: true });
    httpServer?.stop(true);
  }
}
