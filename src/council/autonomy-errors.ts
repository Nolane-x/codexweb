export type CouncilFailureCode =
  | "CAPACITY_BUSY"
  | "SURFACE_UNAVAILABLE"
  | "CONVERSATION_UNAVAILABLE"
  | "CHATGPT_LIMITED"
  | "CHATGPT_SIGNED_OUT"
  | "CONNECTION_FAILED"
  | "RESPONSE_STALLED"
  | "SUBMISSION_UNCERTAIN"
  | "POLICY_BUDGET_EXHAUSTED"
  | "WORK_LEASE_EXPIRED"
  | "WORK_ITEM_STALE"
  | "MANAGER_UNAVAILABLE"
  | "UNKNOWN";

export type CouncilExecutionPhase =
  | "lease-acquired"
  | "conversation-ready"
  | "connector-selected"
  | "prompt-attached"
  | "files-attached"
  | "submit-started"
  | "submit-observed"
  | "response-streaming"
  | "response-complete";

export interface CouncilFailureClassification {
  code: CouncilFailureCode;
  retryableBeforeSubmit: boolean;
}

const PHASE_ORDER: readonly CouncilExecutionPhase[] = [
  "lease-acquired",
  "conversation-ready",
  "connector-selected",
  "prompt-attached",
  "files-attached",
  "submit-started",
  "submit-observed",
  "response-streaming",
  "response-complete",
];

const RETRYABLE_BEFORE_SUBMIT = new Set<CouncilFailureCode>([
  "CAPACITY_BUSY",
  "SURFACE_UNAVAILABLE",
  "CONNECTION_FAILED",
]);

export class CouncilAutonomyError extends Error {
  readonly code: CouncilFailureCode;
  readonly retryableBeforeSubmit: boolean;

  constructor(code: CouncilFailureCode, message: string, retryableBeforeSubmit = RETRYABLE_BEFORE_SUBMIT.has(code)) {
    super(message);
    this.name = "CouncilAutonomyError";
    this.code = code;
    this.retryableBeforeSubmit = retryableBeforeSubmit;
  }
}

export function councilPhaseIndex(phase?: CouncilExecutionPhase): number {
  return phase ? PHASE_ORDER.indexOf(phase) : -1;
}

export function councilPhaseReached(phase: CouncilExecutionPhase | undefined, boundary: CouncilExecutionPhase): boolean {
  return councilPhaseIndex(phase) >= councilPhaseIndex(boundary);
}

export function classifyCouncilFailure(error: unknown): CouncilFailureClassification {
  if (error instanceof CouncilAutonomyError) {
    return { code: error.code, retryableBeforeSubmit: error.retryableBeforeSubmit };
  }
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const text = `${name} ${message}`;
  if (/CouncilSurfaceUnavailableError|surface unavailable|about:blank|all browser surfaces are busy|capacity is full|already has an active turn|already has 5 browser tabs/i.test(text)) {
    const code: CouncilFailureCode = /surface unavailable|about:blank|CouncilSurfaceUnavailableError/i.test(text) ? "SURFACE_UNAVAILABLE" : "CAPACITY_BUSY";
    return { code, retryableBeforeSubmit: true };
  }
  if (/CouncilConversationUnavailableError|conversation.*unavailable|conversation not found|persistent conversation.*missing/i.test(text)) {
    return { code: "CONVERSATION_UNAVAILABLE", retryableBeforeSubmit: false };
  }
  if (/too many requests|rate limit|usage limit|message limit|reached .* limit|try again after|come back later/i.test(text)) {
    return { code: "CHATGPT_LIMITED", retryableBeforeSubmit: false };
  }
  if (/sign in|signed out|session expired|failed to load subscription|authentication/i.test(text)) {
    return { code: "CHATGPT_SIGNED_OUT", retryableBeforeSubmit: false };
  }
  if (/response.*stable completion|response.*stalled|did not create an assistant response/i.test(text)) {
    return { code: "RESPONSE_STALLED", retryableBeforeSubmit: false };
  }
  if (/network|connection|failed to fetch|ECONN|socket|timed out|timeout/i.test(text)) {
    return { code: "CONNECTION_FAILED", retryableBeforeSubmit: true };
  }
  return { code: "UNKNOWN", retryableBeforeSubmit: false };
}

export function boundedFailureMessage(error: unknown, max = 500): string {
  return (error instanceof Error ? error.message : String(error ?? "unknown error"))
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, Math.max(32, Math.min(2_000, max)));
}
