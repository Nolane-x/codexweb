export interface CouncilCandidateTask {
  id: string;
  title: string;
  description: string;
  status: "todo" | "claimed" | "in_progress" | "review" | "done" | "blocked";
}

export type CandidateHealth = "healthy" | "sleeping" | "busy" | "stalled" | "limited" | "signed-out" | "disconnected" | "conversation-missing" | "surface-missing" | "quarantined" | "unknown";

export interface CouncilCandidateAgent {
  id: string;
  name: string;
  role: string;
  mandate: string;
  runtimeStatus: "active" | "sleeping" | "queued" | "failed";
  openTasks: number;
  health: CandidateHealth;
  flapping?: boolean;
}

export interface CouncilCandidateHint {
  agentId: string;
  score: number;
  reasons: string[];
}

const OPEN_BREAKER = new Set<CandidateHealth>(["limited", "signed-out", "quarantined"]);
function words(value: string): Set<string> {
  return new Set(value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(word => word.length >= 3));
}
function overlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const word of a) if (b.has(word)) count += 1;
  return count;
}

export function rankCouncilCandidates(input: {
  task: CouncilCandidateTask;
  agents: CouncilCandidateAgent[];
  completedTaskTexts?: Record<string, string[]>;
  excludeAgentId?: string;
  limit?: number;
}): CouncilCandidateHint[] {
  const taskWords = words(`${input.task.title} ${input.task.description}`);
  const review = input.task.status === "review" || taskWords.has("review") || taskWords.has("audit") || taskWords.has("inspect");
  const limit = Math.max(1, Math.min(12, Math.trunc(input.limit ?? 6)));
  return input.agents
    .filter(agent => agent.id !== input.excludeAgentId && !OPEN_BREAKER.has(agent.health))
    .map(agent => {
      let score = 0;
      const reasons: string[] = [];
      if (agent.health === "healthy" || agent.health === "sleeping") { score += 30; reasons.push("healthy availability"); }
      else if (agent.health === "unknown") score += 8;
      else if (agent.health === "busy") score -= 8;
      else score -= 18;
      if (agent.runtimeStatus === "sleeping") score += 8;
      if (agent.runtimeStatus === "active") { score -= 10; reasons.push("currently active"); }
      const loadPenalty = Math.min(30, Math.max(0, agent.openTasks) * 6);
      score -= loadPenalty;
      if (loadPenalty) reasons.push(`${agent.openTasks} open tasks`);
      const roleWords = words(`${agent.role} ${agent.mandate}`);
      const roleOverlap = overlap(taskWords, roleWords);
      if (roleOverlap) { score += Math.min(30, roleOverlap * 7); reasons.push("role/mandate overlap"); }
      if (review && /review|security|critic|qa|test/i.test(`${agent.role} ${agent.mandate}`)) { score += 18; reasons.push("review-role fit"); }
      const history = input.completedTaskTexts?.[agent.id] ?? [];
      const historyOverlap = history.reduce((best, text) => Math.max(best, overlap(taskWords, words(text))), 0);
      if (historyOverlap) { score += Math.min(20, historyOverlap * 5); reasons.push("related completed work"); }
      if (agent.flapping) { score -= 12; reasons.push("recent health flapping"); }
      return { agentId: agent.id, score: Math.round(score * 100) / 100, reasons: reasons.slice(0, 6) };
    })
    .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId))
    .slice(0, limit);
}
