import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { getConfigDir, loadConfig } from "../config";
import { CouncilAgentRegistry } from "./agent-registry";
import { CouncilBrowserTransport } from "./browser-transport";
import { parseCouncilActionFooter } from "./browser-action-parser";
import { HybridCouncilWakeDelivery } from "./hybrid-wake-delivery";
import { startCouncilHttpServer } from "./http-server";
import { createLauncherPersistentTurnControl } from "./launcher-turn-control";
import { ManagedAgentStateStore } from "./managed-agent-state";
import { ManagedProjectStateStore } from "./managed-project-state";
import { CouncilManagedRuntime } from "./managed-runtime";
import { runCouncilMcpServer } from "./mcp-server";
import { issueCouncilOwnerControl } from "./owner-control";
import { PlaywrightCouncilChatDriver } from "./playwright-council-driver";
import { CouncilStore } from "./store";
import { CouncilWakeEngine } from "./wake-engine";

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function projectName(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "ChatGPT Project";
  return normalized.slice(0, 160);
}

export async function runCouncilMcpMain(args: string[]): Promise<void> {
  const remaining = [...args];
  const storePath = takeOption(remaining, "--store") ?? join(getConfigDir(), "council", "state.json");
  // Accepted during migration because the existing tunnel supervisor still supplies it.
  takeOption(remaining, "--broker-socket");
  if (remaining.length > 0) throw new Error(`Unknown Council MCP arguments: ${remaining.join(" ")}`);

  const store = new CouncilStore(storePath);
  const councilDir = dirname(storePath);
  const ownerDescriptorPath = join(councilDir, "owner-control.json");
  let managedRuntime: CouncilManagedRuntime | undefined;
  let managedState: ManagedAgentStateStore | undefined;
  let fallbackWake: CouncilWakeEngine | undefined;
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
    }
    if (config.mode === "full") fallbackWake = new CouncilWakeEngine(store, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.info(`[council-runtime] managed browser transport unavailable: ${message}`);
  }

  let ownerToken: string | undefined;
  const httpServer = startCouncilHttpServer(store, {
    onError: message => console.error(`[council-http] ${message}`),
    ...(managedRuntime ? {
      managedSnapshot: () => ({ project: managedRuntime!.activeProject() ?? null, agents: managedRuntime!.publicAgents() }),
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
      },
    } : {}),
  });

  if (httpServer && managedRuntime) {
    try {
      const descriptor = issueCouncilOwnerControl(ownerDescriptorPath, httpServer.port);
      ownerToken = descriptor.token;
    } catch (error) {
      httpServer.stop(true);
      throw error;
    }
  }

  const wakeDelivery = managedRuntime || fallbackWake
    ? new HybridCouncilWakeDelivery(store, managedRuntime, fallbackWake)
    : undefined;

  try {
    await runCouncilMcpServer({
      store,
      ...(wakeDelivery ? { wakeDelivery } : {}),
      ...(managedRuntime ? { managedRuntime } : {}),
    });
  } finally {
    ownerToken = undefined;
    rmSync(ownerDescriptorPath, { force: true });
    httpServer?.stop(true);
  }
}
