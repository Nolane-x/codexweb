import type { CouncilAutonomyKernel } from "./autonomy-kernel";
import type { CouncilMemoryIndex } from "./memory-index";
import type { CouncilObservationStore } from "./observation-store";
import type { CouncilStore } from "./store";

function setFor(map: Map<string, Set<string>>, key: string): Set<string> {
  let value = map.get(key);
  if (!value) { value = new Set<string>(); map.set(key, value); }
  return value;
}

export class CouncilMemoryProjector {
  private readonly council: CouncilStore;
  private readonly observations: CouncilObservationStore;
  private readonly memory: CouncilMemoryIndex;
  private readonly autonomy?: CouncilAutonomyKernel;
  private readonly scanIntervalMs: number;
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private scanning = false;
  private requested = false;

  constructor(options: {
    council: CouncilStore;
    observations: CouncilObservationStore;
    memory: CouncilMemoryIndex;
    autonomy?: CouncilAutonomyKernel;
    scanIntervalMs?: number;
  }) {
    this.council = options.council;
    this.observations = options.observations;
    this.memory = options.memory;
    this.autonomy = options.autonomy;
    this.scanIntervalMs = Math.max(5_000, Math.trunc(options.scanIntervalMs ?? 15_000));
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.council.onMutation(() => this.scan());
    this.timer = setInterval(() => this.scan(), this.scanIntervalMs);
    this.timer.unref?.();
    this.scan();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  scan(): void {
    if (this.scanning) { this.requested = true; return; }
    this.scanning = true;
    try {
      const state = this.council.snapshot();
      const roomIds = new Set<string>();
      const decisionIds = new Map<string, Set<string>>();
      const taskIds = new Map<string, Set<string>>();

      for (const decision of state.decisions) {
        roomIds.add(decision.roomId);
        setFor(decisionIds, decision.roomId).add(decision.id);
        this.memory.upsert({
          projectRoomId: decision.roomId,
          sourceType: "decision",
          sourceId: decision.id,
          text: [decision.title, `Policy: ${decision.policy}`, `Rationale: ${decision.rationale}`, decision.unresolvedRisks.length ? `Unresolved risks: ${decision.unresolvedRisks.join("; ")}` : ""].filter(Boolean).join(" | "),
          agentIds: [decision.createdByAgentId],
          createdAt: decision.createdAt,
        });
      }

      for (const task of state.tasks) {
        roomIds.add(task.roomId);
        setFor(taskIds, task.roomId).add(task.id);
        this.memory.upsert({
          projectRoomId: task.roomId,
          sourceType: "task",
          sourceId: task.id,
          text: `${task.title} | ${task.description} | status=${task.status}`,
          agentIds: [task.createdByAgentId, ...(task.assigneeAgentId ? [task.assigneeAgentId] : [])],
          taskIds: [task.id],
          createdAt: task.createdAt,
        });
      }

      const observationIds = new Map<string, Set<string>>();
      const managerAnalysisIds = new Map<string, Set<string>>();
      const digestBlocks = new Map<string, Array<{ at: string; text: string }>>();
      for (const summary of this.observations.list()) {
        if (summary.status === "running") continue;
        const run = this.observations.get(summary.id);
        if (!run) continue;
        roomIds.add(run.projectRoomId);
        setFor(observationIds, run.projectRoomId).add(run.id);
        const health = Object.entries(summary.health).filter(([, count]) => count > 0).map(([stateName, count]) => `${stateName}:${count}`).join(", ");
        this.memory.upsert({
          projectRoomId: run.projectRoomId,
          sourceType: "observation",
          sourceId: run.id,
          text: `Manager observation ${run.status}; health ${health || "none"}${run.error ? `; error ${run.error}` : ""}`,
          agentIds: [run.managerAgentId, ...run.agents.map(agent => agent.agentId)],
          createdAt: run.completedAt ?? run.startedAt,
        });
        const blocks = digestBlocks.get(run.projectRoomId) ?? [];
        blocks.push({
          at: run.completedAt ?? run.startedAt,
          text: JSON.stringify({
            observedAt: run.completedAt ?? run.startedAt,
            status: run.status,
            managerAgentId: run.managerAgentId,
            health: summary.health,
            managerAnalysis: run.managerAnalysis?.slice(0, 3_000),
            error: run.error?.slice(0, 1_000),
          }),
        });
        digestBlocks.set(run.projectRoomId, blocks);
        if (run.managerAnalysis) {
          setFor(managerAnalysisIds, run.projectRoomId).add(run.id);
          this.memory.upsert({
            projectRoomId: run.projectRoomId,
            sourceType: "manager-analysis",
            sourceId: run.id,
            text: run.managerAnalysis,
            agentIds: [run.managerAgentId, ...run.agents.map(agent => agent.agentId)],
            createdAt: run.completedAt ?? run.startedAt,
          });
        }
      }

      const activeProject = this.autonomy?.status().projectRoomId;
      if (activeProject) roomIds.add(activeProject);
      if (this.autonomy) {
        const workById = new Map(this.autonomy.work.snapshot().items.map(item => [item.id, item] as const));
        const auditByRoom = new Map<string, Set<string>>();
        for (const event of this.autonomy.auditList(200)) {
          const work = workById.get(event.workItemId);
          if (!work) continue;
          const sourceId = `audit-${event.sequence}`;
          roomIds.add(work.projectRoomId);
          setFor(auditByRoom, work.projectRoomId).add(sourceId);
          this.memory.upsert({
            projectRoomId: work.projectRoomId,
            sourceType: "audit",
            sourceId,
            text: `${event.kind} ${event.transition}${event.code ? ` ${event.code}` : ""}${event.reason ? `: ${event.reason}` : ""}`,
            agentIds: [event.sourceAgentId, event.targetAgentId].filter((value): value is string => Boolean(value)),
            taskIds: event.taskId ? [event.taskId] : [],
            createdAt: event.timestamp,
          });
        }
        for (const roomId of roomIds) this.memory.retainProjectSources(roomId, "audit", auditByRoom.get(roomId) ?? []);
      }

      for (const roomId of roomIds) {
        this.memory.retainProjectSources(roomId, "decision", decisionIds.get(roomId) ?? []);
        this.memory.retainProjectSources(roomId, "task", taskIds.get(roomId) ?? []);
        this.memory.retainProjectSources(roomId, "observation", observationIds.get(roomId) ?? []);
        this.memory.retainProjectSources(roomId, "manager-analysis", managerAnalysisIds.get(roomId) ?? []);
        const digest = (digestBlocks.get(roomId) ?? [])
          .sort((left, right) => right.at.localeCompare(left.at))
          .slice(0, 8)
          .map(block => block.text)
          .join("\n")
          .slice(0, 16_000);
        if (digest) this.memory.upsert({ projectRoomId: roomId, sourceType: "digest", sourceId: roomId, text: digest });
        else this.memory.deleteProjectSource(roomId, "digest", roomId);
      }
    } finally {
      this.scanning = false;
      if (this.requested) { this.requested = false; this.scan(); }
    }
  }
}
