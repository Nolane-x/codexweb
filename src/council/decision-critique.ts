interface CritiqueMessage {
  id: string;
  roomId: string;
  authorAgentId: string;
  kind: string;
  threadId?: string;
  replyTo?: string;
  mentions?: string[];
}
interface CritiqueTask { roomId: string; createdByAgentId?: string; assigneeAgentId?: string }
interface CritiqueWake { roomId: string; sourceAgentId?: string; targetAgentId?: string }
export interface IndependentCritiqueInput { messages: CritiqueMessage[]; tasks: CritiqueTask[]; wakes: CritiqueWake[] }
export interface IndependentCritiqueGateResult { required: boolean; satisfied: boolean; reason?: string; proposalId?: string; reviewerAgentId?: string }

export function evaluateIndependentCritiqueGate(state: IndependentCritiqueInput, roomId: string): IndependentCritiqueGateResult {
  const roomMessages = state.messages.filter(message => message.roomId === roomId);
  let proposalIndex = -1;
  for (let index = roomMessages.length - 1; index >= 0; index -= 1) {
    if (roomMessages[index]?.kind === "proposal") { proposalIndex = index; break; }
  }
  if (proposalIndex < 0) return { required: false, satisfied: true };
  const proposal = roomMessages[proposalIndex]!;
  const involved = new Set<string>([proposal.authorAgentId]);
  for (const message of roomMessages) {
    involved.add(message.authorAgentId);
    for (const mention of message.mentions ?? []) involved.add(mention);
  }
  for (const task of state.tasks) {
    if (task.roomId !== roomId) continue;
    if (task.createdByAgentId) involved.add(task.createdByAgentId);
    if (task.assigneeAgentId) involved.add(task.assigneeAgentId);
  }
  for (const wake of state.wakes) {
    if (wake.roomId !== roomId) continue;
    if (wake.sourceAgentId) involved.add(wake.sourceAgentId);
    if (wake.targetAgentId) involved.add(wake.targetAgentId);
  }
  const others = [...involved].filter(agentId => agentId !== proposal.authorAgentId);
  if (others.length === 0) return { required: false, satisfied: true, proposalId: proposal.id };

  const threadId = proposal.threadId ?? proposal.id;
  const critique = roomMessages.slice(proposalIndex + 1).find(message =>
    message.authorAgentId !== proposal.authorAgentId
    && (message.threadId === threadId || message.replyTo === proposal.id),
  );
  if (critique) return { required: true, satisfied: true, proposalId: proposal.id, reviewerAgentId: critique.authorAgentId };
  return {
    required: true,
    satisfied: false,
    proposalId: proposal.id,
    reason: `an independent reply from another involved participant is required in the latest proposal thread (${proposal.id})`,
  };
}
