import { evaluateIndependentCritiqueGate } from "./decision-critique";
import { isActiveCouncilWake } from "./store";
import type { CouncilState } from "./types";

export interface CouncilDecisionGateResult {
  ready: boolean;
  reasons: string[];
}

export function evaluateCouncilDecisionGate(state: CouncilState, roomId: string): CouncilDecisionGateResult {
  const reasons: string[] = [];
  const proposals = state.messages.filter(message => message.roomId === roomId && message.kind === "proposal");
  if (proposals.length === 0) reasons.push("at least one explicit proposal is required before final policy");
  else {
    const critique = evaluateIndependentCritiqueGate(state, roomId);
    if (!critique.satisfied && critique.reason) reasons.push(critique.reason);
  }

  const blockedTasks = state.tasks.filter(task => task.roomId === roomId && task.status === "blocked");
  if (blockedTasks.length > 0) reasons.push(`${blockedTasks.length} blocked task(s) remain unresolved`);

  const activeWakes = state.wakes.filter(wake => wake.roomId === roomId && isActiveCouncilWake(wake));
  if (activeWakes.length > 0) reasons.push(`${activeWakes.length} Council wake/review request(s) are still active`);

  return { ready: reasons.length === 0, reasons };
}

export function assertCouncilDecisionGate(state: CouncilState, roomId: string): void {
  const result = evaluateCouncilDecisionGate(state, roomId);
  if (!result.ready) throw new Error(`Council final decision gate is not ready: ${result.reasons.join("; ")}`);
}
