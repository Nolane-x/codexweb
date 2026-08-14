import { randomUUID } from "node:crypto";
import type { CouncilDecision, CouncilState, CouncilTask, CouncilTaskStatus, CouncilWakeEvent, CouncilWakeStatus } from "./types";
import { councilNow, councilStringList, councilText, MAX_COUNCIL_DECISIONS, MAX_COUNCIL_TASKS, MAX_COUNCIL_WAKES } from "./validation";

export const COUNCIL_WAKE_EXPIRY_MS = 5 * 60_000;

export function addCouncilDecision(state: CouncilState, input: { roomId: string; createdByAgentId: string; title: string; policy: string; rationale: string; acceptedArguments?: string[]; rejectedArguments?: string[]; unresolvedRisks?: string[] }): CouncilDecision { const decision: CouncilDecision = { id: `decision_${randomUUID()}`, roomId: input.roomId, createdByAgentId: input.createdByAgentId, title: councilText(input.title, "decision title", 240), policy: councilText(input.policy, "decision policy", 12_000), rationale: councilText(input.rationale, "decision rationale", 12_000), acceptedArguments: councilStringList(input.acceptedArguments, "accepted arguments"), rejectedArguments: councilStringList(input.rejectedArguments, "rejected arguments"), unresolvedRisks: councilStringList(input.unresolvedRisks, "unresolved risks"), createdAt: councilNow() }; state.decisions.push(decision); if (state.decisions.length > MAX_COUNCIL_DECISIONS) state.decisions.splice(0, state.decisions.length - MAX_COUNCIL_DECISIONS); return decision; }
export function addCouncilTask(state: CouncilState, input: { roomId: string; createdByAgentId: string; title: string; description: string; assigneeAgentId?: string }): CouncilTask { const stamp = councilNow(); const task: CouncilTask = { id: `task_${randomUUID()}`, roomId: input.roomId, createdByAgentId: input.createdByAgentId, ...(input.assigneeAgentId ? { assigneeAgentId: input.assigneeAgentId } : {}), title: councilText(input.title, "task title", 240), description: councilText(input.description, "task description", 8_000), status: "todo", createdAt: stamp, updatedAt: stamp }; state.tasks.push(task); if (state.tasks.length > MAX_COUNCIL_TASKS) state.tasks.splice(0, state.tasks.length - MAX_COUNCIL_TASKS); return task; }
export function updateCouncilTask(task: CouncilTask, status: CouncilTaskStatus, assigneeAgentId?: string): CouncilTask { if (assigneeAgentId !== undefined) task.assigneeAgentId = assigneeAgentId; task.status = status; task.updatedAt = councilNow(); return task; }
export function addCouncilWake(state: CouncilState, input: { targetAgentId: string; roomId: string; reason: string; sourceAgentId?: string; sourceMessageId?: string }): CouncilWakeEvent { const stamp = councilNow(); const wake: CouncilWakeEvent = { id: `wake_${randomUUID()}`, targetAgentId: input.targetAgentId, ...(input.sourceAgentId ? { sourceAgentId: input.sourceAgentId } : {}), roomId: input.roomId, ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}), reason: councilText(input.reason, "wake reason", 4_000), status: "queued", attempts: 0, expiresAt: new Date(Date.parse(stamp) + COUNCIL_WAKE_EXPIRY_MS).toISOString(), transitions: [{ status: "queued", at: stamp }], createdAt: stamp, updatedAt: stamp }; state.wakes.push(wake); if (state.wakes.length > MAX_COUNCIL_WAKES) state.wakes.splice(0, state.wakes.length - MAX_COUNCIL_WAKES); return wake; }
export function updateCouncilWake(wake: CouncilWakeEvent, status: CouncilWakeStatus, lastError?: string, at?: string): CouncilWakeEvent {
  const stamp = at ?? councilNow();
  const previousStatus = wake.status;
  if (!wake.transitions) wake.transitions = [{ status: previousStatus, at: wake.updatedAt || wake.createdAt }];
  wake.status = status;
  if (status === "dispatched" || status === "delivering") wake.attempts += 1;
  if (lastError) wake.lastError = councilText(lastError, "wake error", 4_000);
  else if (status !== "failed") delete wake.lastError;
  wake.transitions.push({ status, at: stamp });
  wake.updatedAt = stamp;
  return wake;
}
