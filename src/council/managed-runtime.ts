import type { CouncilAgentRegistry } from "./agent-registry";
import { CouncilAgentManager } from "./agent-manager";
import type { CouncilBrowserTransport } from "./browser-transport";
import type { ParsedCouncilActionFooter } from "./browser-actions";
import { assertCouncilDecisionGate } from "./decision-gate";
import { COUNCIL_PERMISSIONS, type CouncilPermission, type ManagedAgentRecord, type ManagedAgentStateStore } from "./managed-agent-state";
import type { ManagedCouncilProject, ManagedProjectStateStore } from "./managed-project-state";
import type { CouncilStore } from "./store";
import type { CouncilWakeEvent } from "./types";

export interface CouncilManagedRuntimeOptions {
  council: CouncilStore;
  managed: ManagedAgentStateStore;
  project: ManagedProjectStateStore;
  registry: CouncilAgentRegistry;
  transport: CouncilBrowserTransport;
  parseAnswer: (text: string) => ParsedCouncilActionFooter;
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
  private manager?: CouncilAgentManager;
  private managerProjectUpdatedAt?: string;

  constructor(options: CouncilManagedRuntimeOptions) {
    this.council = options.council;
    this.managed = options.managed;
    this.project = options.project;
    this.registry = options.registry;
    this.transport = options.transport;
    this.parseAnswer = options.parseAnswer;
  }

  activeProject(): ManagedCouncilProject | undefined { return this.project.get(); }

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

  authorizeManaged(agentId: string, permission: CouncilPermission): void {
    const agent = this.managed.get(agentId);
    if (!agent) return; // legacy/unmanaged Council participants retain compatibility behavior.
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

  async spawnAgent(sourceAgentId: string, input: { name: string; role: string; mandate: string; requestedAgentId?: string; permissions?: CouncilPermission[] }): Promise<ManagedAgentRecord> {
    const project = this.requireProject();
    return await this.managerFor(project).spawnAgent(sourceAgentId, input, 0, project.roomId);
  }

  canDeliverWake(targetAgentId: string): boolean {
    return Boolean(this.project.get() && this.managed.get(targetAgentId));
  }

  async deliverWakeEvent(wake: CouncilWakeEvent): Promise<boolean> {
    if (!this.canDeliverWake(wake.targetAgentId)) return false;
    const project = this.requireProject();
    if (wake.roomId !== project.roomId) throw new Error(`Managed agent ${wake.targetAgentId} belongs to active project room ${project.roomId}, not ${wake.roomId}`);
    await this.managerFor(project).enqueueWakeEvent(wake, 0);
    return true;
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
      });
      this.managerProjectUpdatedAt = project.updatedAt;
    }
    return this.manager;
  }
}
