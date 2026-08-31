import type { CouncilAgentRegistry } from "./agent-registry";
import { CouncilAgentManager, type CouncilManagedSpawnInput } from "./agent-manager";
import type { CouncilBrowserCaptureResult, CouncilBrowserTransport, CouncilExecutionObserver, CouncilPromptAttachment } from "./browser-transport";
import type { ParsedCouncilActionFooter } from "./browser-actions";
import { assertCouncilDecisionGate } from "./decision-gate";
import { COUNCIL_PERMISSIONS, type CouncilPermission, type ManagedAgentRecord, type ManagedAgentStateStore } from "./managed-agent-state";
import type { ManagedCouncilProject, ManagedProjectStateStore } from "./managed-project-state";
import type { RepoWorkspaceBinding } from "./repo-workspace";
import type { CouncilStore } from "./store";
import type { CouncilWakeEvent } from "./types";
import { CouncilWorkScheduler, type CouncilWorkSchedulerSnapshot } from "./work-scheduler";

export interface CouncilManagedRuntimeOptions {
  council: CouncilStore;
  managed: ManagedAgentStateStore;
  project: ManagedProjectStateStore;
  registry: CouncilAgentRegistry;
  transport: CouncilBrowserTransport;
  parseAnswer: (text: string) => ParsedCouncilActionFooter;
  scheduler?: CouncilWorkScheduler;
}

export interface CouncilManagedAutonomyHooks {
  enqueueWake(wake: CouncilWakeEvent, depth?: number): Promise<void>;
  enqueuePreparedSpawn(input: { sourceAgentId: string; targetAgentId: string; roomId: string; depth: number }): Promise<void>;
}

export interface PublicManagedAgent extends Omit<ManagedAgentRecord, "conversationUrl" | "checkpoint"> {
  conversationBound: boolean;
  checkpointSaved: boolean;
  runtimeStatus: "active" | "sleeping" | "queued" | "failed";
}

export class CouncilManagedRuntime {
  private readonly council: CouncilStore;
  private readonly managed: ManagedAgentStateStore;
  private readonly project: ManagedProjectStateStore;
  private readonly registry: CouncilAgentRegistry;
  private readonly transport: CouncilBrowserTransport;
  private readonly parseAnswer: (text: string) => ParsedCouncilActionFooter;
  private readonly scheduler: CouncilWorkScheduler;
  private manager?: CouncilAgentManager;
  private managerProjectUpdatedAt?: string;
  private autonomy?: CouncilManagedAutonomyHooks;

  constructor(options: CouncilManagedRuntimeOptions) {
    this.council = options.council;
    this.managed = options.managed;
    this.project = options.project;
    this.registry = options.registry;
    this.transport = options.transport;
    this.parseAnswer = options.parseAnswer;
    this.scheduler = options.scheduler ?? new CouncilWorkScheduler();
  }

  attachAutonomy(hooks: CouncilManagedAutonomyHooks | undefined): void {
    this.autonomy = hooks;
    this.manager = undefined;
    this.managerProjectUpdatedAt = undefined;
  }

  activeProject(): ManagedCouncilProject | undefined { return this.project.get(); }
  schedulerSnapshot(): CouncilWorkSchedulerSnapshot { return this.scheduler.snapshot(); }

  publicAgents(): PublicManagedAgent[] {
    return this.managed.list().map(agent => {
      const { conversationUrl, checkpoint, ...publicAgent } = agent;
      const runtime = this.registry.get(agent.id);
      return {
        ...publicAgent,
        conversationBound: Boolean(conversationUrl),
        checkpointSaved: Boolean(checkpoint),
        runtimeStatus: runtime?.status ?? "sleeping",
      };
    });
  }

  managedStatus(agentId: string): PublicManagedAgent["runtimeStatus"] | undefined {
    if (!this.managed.get(agentId)) return undefined;
    return this.registry.get(agentId)?.status ?? "sleeping";
  }

  supervisorAgents(): ManagedAgentRecord[] { return this.managed.list(); }

  authorizeManaged(agentId: string, permission: CouncilPermission): void {
    const agent = this.managed.get(agentId);
    if (!agent) return;
    if (!agent.permissions.includes(permission)) throw new Error(`Council agent ${agent.id} requires ${permission} permission`);
  }

  authorizeManagedDecision(agentId: string, roomId: string): void {
    if (!this.managed.get(agentId)) return;
    this.authorizeManaged(agentId, "finalize");
    assertCouncilDecisionGate(this.council.snapshot(), roomId);
  }

  authorizeManagedTaskUpdate(agentId: string, taskId: string, assigneeAgentId?: string): void {
    const agent = this.managed.get(agentId);
    if (!agent) return;
    if (assigneeAgentId !== undefined) {
      this.authorizeManaged(agent.id, "assign");
      return;
    }
    const task = this.council.snapshot().tasks.find(candidate => candidate.id === taskId);
    if (!task) throw new Error(`Council task does not exist: ${taskId}`);
    if (task.assigneeAgentId && task.assigneeAgentId !== agent.id && !agent.permissions.includes("assign")) {
      throw new Error(`Council agent ${agent.id} cannot update another agent's task`);
    }
  }

  saveManagedCheckpoint(agentId: string, summary: string): void {
    if (!this.managed.get(agentId)) return;
    this.managed.checkpoint(agentId, summary);
  }

  startProject(actorAgentId: string, input: { roomId: string; name: string; mission: string; mandate: string }): { project: ManagedCouncilProject; lead: ManagedAgentRecord } {
    const councilSnapshot = this.council.snapshot();
    const actor = councilSnapshot.agents.find(candidate => candidate.id === actorAgentId);
    if (!actor) throw new Error(`Council actor does not exist: ${actorAgentId}`);
    const existing = this.project.get();
    if (existing && (existing.leadAgentId !== actor.id || existing.roomId !== input.roomId)) {
      throw new Error(`Managed Council project ${existing.roomId} is already owned by lead ${existing.leadAgentId}`);
    }
    if (!existing) {
      if (this.managed.list().length > 0) {
        throw new Error("Managed agent state already exists without an active project; reset or recover the managed project state before bootstrapping a new lead");
      }
      const firstParticipant = [...councilSnapshot.agents].sort((left, right) => left.joinedAt.localeCompare(right.joinedAt) || left.id.localeCompare(right.id))[0];
      if (!firstParticipant || firstParticipant.id !== actor.id) {
        throw new Error(`Only the first Council participant may bootstrap the managed project lead; expected ${firstParticipant?.id ?? "none"}`);
      }
    }
    const room = this.council.ensureRoom({ id: input.roomId, name: input.name, mission: input.mission });
    const project = this.project.start({ roomId: room.id, name: room.name, mission: room.mission, leadAgentId: actor.id });
    const manager = this.managerFor(project);
    const lead = manager.registerLead({
      id: actor.id,
      name: actor.name,
      role: actor.role,
      mandate: input.mandate,
      permissions: [...COUNCIL_PERMISSIONS],
    });
    return { project, lead };
  }

  bindRepoWorkspace(actorAgentId: string, input: RepoWorkspaceBinding): ManagedCouncilProject {
    const project = this.requireProject();
    if (actorAgentId !== project.leadAgentId) throw new Error(`Only the active managed Lead ${project.leadAgentId} can bind repository workspace metadata`);
    if (!this.council.snapshot().agents.some(agent => agent.id === actorAgentId)) throw new Error(`Council actor does not exist: ${actorAgentId}`);
    return this.project.bindWorkspace(input);
  }

  async spawnAgent(sourceAgentId: string, input: CouncilManagedSpawnInput): Promise<ManagedAgentRecord> {
    const project = this.requireProject();
    const manager = this.managerFor(project);
    if (!this.autonomy) return await manager.spawnAgent(sourceAgentId, input, 0, project.roomId);
    const child = manager.prepareSpawnAgent(sourceAgentId, input, project.roomId);
    await this.autonomy.enqueuePreparedSpawn({ sourceAgentId, targetAgentId: child.id, roomId: project.roomId, depth: 0 });
    return child;
  }

  async executePreparedSpawn(agentId: string, roomId: string, depth = 0, onPhase?: CouncilExecutionObserver): Promise<ManagedAgentRecord> {
    const project = this.requireProject();
    if (roomId !== project.roomId) throw new Error(`Managed spawn belongs to active project room ${project.roomId}, not ${roomId}`);
    return await this.managerFor(project).executePreparedSpawn(agentId, roomId, depth, onPhase);
  }

  canDeliverWake(targetAgentId: string): boolean {
    return Boolean(this.project.get() && this.managed.get(targetAgentId));
  }

  async deliverWakeEvent(wake: CouncilWakeEvent): Promise<boolean> {
    if (!this.canDeliverWake(wake.targetAgentId)) return false;
    const project = this.requireProject();
    if (wake.roomId !== project.roomId) throw new Error(`Managed agent ${wake.targetAgentId} belongs to active project room ${project.roomId}, not ${wake.roomId}`);
    if (this.autonomy) await this.autonomy.enqueueWake(wake, 0);
    else await this.managerFor(project).enqueueWakeEvent(wake, 0);
    return true;
  }

  async executeWakeEvent(wake: CouncilWakeEvent, depth = 0, onPhase?: CouncilExecutionObserver): Promise<void> {
    if (!this.canDeliverWake(wake.targetAgentId)) throw new Error(`managed wake target does not exist: ${wake.targetAgentId}`);
    const project = this.requireProject();
    if (wake.roomId !== project.roomId) throw new Error(`Managed agent ${wake.targetAgentId} belongs to active project room ${project.roomId}, not ${wake.roomId}`);
    await this.managerFor(project).executeWakeEvent(wake, depth, onPhase);
  }

  async focusAgentConversation(agentId: string): Promise<{ conversationUrl: string }> {
    const agent = this.managed.get(agentId);
    if (!agent) throw new Error(`managed agent does not exist: ${agentId}`);
    if (!agent.conversationUrl) throw new Error(`managed agent ${agentId} has no persistent ChatGPT conversation`);
    return await this.scheduler.enqueue(`focus:${agent.id}`, async () => {
      return await this.transport.focusConversation({ agentId: agent.id, conversationUrl: agent.conversationUrl! });
    }, { attempts: 3, baseDelayMs: 500, maxDelayMs: 2_000, retryable: error => error instanceof Error && /capacity|active turn|surface unavailable/i.test(error.message) });
  }

  async captureAgent(agentId: string): Promise<CouncilBrowserCaptureResult> {
    const agent = this.managed.get(agentId);
    if (!agent) throw new Error(`managed agent does not exist: ${agentId}`);
    if (!agent.conversationUrl) throw new Error(`managed agent ${agentId} has no persistent ChatGPT conversation`);
    return await this.scheduler.enqueue(`observe:${agent.id}`, async () => {
      return await this.transport.captureConversation({ agentId: agent.id, conversationUrl: agent.conversationUrl! });
    }, { attempts: 3, baseDelayMs: 1_000, maxDelayMs: 4_000, retryable: error => error instanceof Error && /capacity|active turn|surface unavailable/i.test(error.message) });
  }

  async runManagerObservation(agentId: string, prompt: string, attachments: CouncilPromptAttachment[], onPhase?: CouncilExecutionObserver): Promise<string> {
    const project = this.requireProject();
    if (!this.managed.get(agentId)) throw new Error(`managed manager does not exist: ${agentId}`);
    return await this.managerFor(project).runManagerObservation(agentId, prompt, attachments, onPhase);
  }

  private async routeSpawnEffect(sourceAgentId: string, input: CouncilManagedSpawnInput, depth: number, roomId: string): Promise<void> {
    const project = this.requireProject();
    const manager = this.managerFor(project);
    if (!this.autonomy) {
      await manager.spawnAgent(sourceAgentId, input, depth, roomId);
      return;
    }
    const child = manager.prepareSpawnAgent(sourceAgentId, input, roomId);
    await this.autonomy.enqueuePreparedSpawn({ sourceAgentId, targetAgentId: child.id, roomId, depth });
  }

  private requireProject(): ManagedCouncilProject {
    const project = this.project.get();
    if (!project) throw new Error("No managed Council project is active; bootstrap the first lead with council_start_project");
    return project;
  }

  private managerFor(project: ManagedCouncilProject): CouncilAgentManager {
    if (!this.manager || this.managerProjectUpdatedAt !== project.updatedAt) {
      this.manager = new CouncilAgentManager({
        council: this.council,
        managed: this.managed,
        registry: this.registry,
        transport: this.transport,
        parseAnswer: this.parseAnswer,
        projectMission: project.mission,
        defaultRoomId: project.roomId,
        scheduler: this.scheduler,
        effectSink: {
          deliverWake: async (wake, depth) => {
            if (this.autonomy) await this.autonomy.enqueueWake(wake, depth);
            else await this.managerFor(this.requireProject()).enqueueWakeEvent(wake, depth);
          },
          spawn: async (sourceAgentId, input, depth, roomId) => await this.routeSpawnEffect(sourceAgentId, input, depth, roomId),
        },
      });
      this.managerProjectUpdatedAt = project.updatedAt;
    }
    return this.manager;
  }
}
