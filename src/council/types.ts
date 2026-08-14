export type CouncilAgentStatus = "awake" | "sleeping" | "offline";
export type CouncilMessageKind = "message" | "proposal" | "decision" | "system";
export type CouncilTaskStatus = "todo" | "claimed" | "in_progress" | "review" | "done" | "blocked";
/**
 * Canonical vNext wake states are queued/dispatched/target-running/replied/failed/expired.
 * Legacy states remain accepted during the staged migration and are normalized in later slices.
 */
export type CouncilWakeStatus = "queued" | "dispatched" | "target-running" | "replied" | "failed" | "expired" | "pending" | "delivering" | "acknowledged";

export interface CouncilAgent {
  id: string;
  name: string;
  role: string;
  status: CouncilAgentStatus;
  joinedAt: string;
  updatedAt: string;
}

export type CouncilAgentPresence =
  | { agentId: string; freshness: "unknown" }
  | { agentId: string; lastSeenAt: string; leaseExpiresAt: string; freshness: "fresh" | "stale" };

/** Private capability material. Never expose this array through the public dashboard or MCP status. */
export interface CouncilAgentCredential {
  agentId: string;
  token: string;
  issuedAt: string;
}

export interface CouncilRoom {
  id: string;
  name: string;
  mission: string;
  createdAt: string;
  updatedAt: string;
}

export interface CouncilMessage {
  id: string;
  roomId: string;
  authorAgentId: string;
  kind: CouncilMessageKind;
  body: string;
  threadId: string;
  replyTo?: string;
  mentions: string[];
  createdAt: string;
}

export interface CouncilDecision {
  id: string;
  roomId: string;
  createdByAgentId: string;
  title: string;
  policy: string;
  rationale: string;
  acceptedArguments: string[];
  rejectedArguments: string[];
  unresolvedRisks: string[];
  createdAt: string;
}

export interface CouncilTask {
  id: string;
  roomId: string;
  createdByAgentId: string;
  assigneeAgentId?: string;
  title: string;
  description: string;
  status: CouncilTaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CouncilWakeTransition {
  status: CouncilWakeStatus;
  at: string;
}

export interface CouncilWakeEvent {
  id: string;
  targetAgentId: string;
  sourceAgentId?: string;
  roomId: string;
  sourceMessageId?: string;
  reason: string;
  status: CouncilWakeStatus;
  attempts: number;
  lastError?: string;
  /** Added in Council vNext; legacy V1 persisted wakes may not have this field. */
  expiresAt?: string;
  /** Added in Council vNext; legacy V1 persisted wakes may not have this field. */
  transitions?: CouncilWakeTransition[];
  createdAt: string;
  updatedAt: string;
}

export interface CouncilCheckpoint {
  agentId: string;
  roomId?: string;
  summary: string;
  updatedAt: string;
}

export interface CouncilState {
  version: 1;
  agents: CouncilAgent[];
  /** Private per-agent bearer capabilities. State file permissions are 0600. */
  credentials: CouncilAgentCredential[];
  rooms: CouncilRoom[];
  messages: CouncilMessage[];
  decisions: CouncilDecision[];
  tasks: CouncilTask[];
  wakes: CouncilWakeEvent[];
  checkpoints: CouncilCheckpoint[];
}

export interface CouncilContextPacket {
  version: 1;
  identity: CouncilAgent;
  room: CouncilRoom;
  wake?: CouncilWakeEvent;
  checkpoint?: CouncilCheckpoint;
  recentMessages: CouncilMessage[];
  decisions: CouncilDecision[];
  tasks: CouncilTask[];
  generatedAt: string;
  instruction: string;
}
