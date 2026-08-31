export type CouncilChatGptState =
  | "DISCOVERED"
  | "IDLE"
  | "QUEUED"
  | "THINKING"
  | "DEEP_THINKING"
  | "STREAMING"
  | "TOOL_RUNNING"
  | "WAITING_USER"
  | "COMPLETING"
  | "COMPLETED"
  | "RATE_LIMITED"
  | "CONVERSATION_LIMIT"
  | "CONNECTION_LOST"
  | "STALLED"
  | "FAILED"
  | "DOM_DRIFT";

export interface CouncilChatGptToolActivity { name: string; active: boolean }

export interface CouncilChatGptSnapshot {
  composerPresent?: boolean;
  composerText?: string;
  responsePresent?: boolean;
  assistantText?: string;
  responseSignature?: string;
  completionActionVisible?: boolean;
  generationRunning?: boolean;
  stopVisible?: boolean;
  waitingUser?: boolean;
  rateLimited: boolean;
  conversationLimit: boolean;
  connectionLost: boolean;
  terminalError: boolean;
  toolActivities?: CouncilChatGptToolActivity[];
  lastAssistantMutationAt?: number;
  lastStatusMutationAt?: number;
}

export interface CouncilChatGptTelemetry {
  submittedAt?: number;
  activeRequests?: number;
  lastNetworkActivityAt?: number;
}

export interface CouncilChatGptDomHealth {
  sawResponse?: boolean;
  missingResponseSince?: number;
  emptyCompletionSince?: number;
  missingCompletionActionSince?: number;
  missingCompletionText?: string;
}

export interface CouncilChatGptStateResult {
  state: CouncilChatGptState;
  confidence: number;
  reason: string;
  evidence: string[];
  lastProgressAt: number;
  lastAssistantText: string;
  phaseStartedAt: number;
  completionCandidate?: { signature: string; since: number };
  domHealth: CouncilChatGptDomHealth;
}

export interface CouncilChatGptPreviousState extends Partial<CouncilChatGptStateResult> {}

export interface CouncilChatGptThresholds {
  deepThinkingMs: number;
  stallMs: number;
  completionSettleMs: number;
  responseDomGraceMs: number;
  emptyCompletionGraceMs: number;
  completionActionGraceMs: number;
  networkFreshMs: number;
  statusFreshMs: number;
  streamingFreshMs: number;
}

export const DEFAULT_COUNCIL_CHATGPT_THRESHOLDS: Readonly<CouncilChatGptThresholds> = Object.freeze({
  deepThinkingMs: 45_000,
  stallMs: 120_000,
  completionSettleMs: 1_500,
  responseDomGraceMs: 30_000,
  emptyCompletionGraceMs: 10_000,
  completionActionGraceMs: 20_000,
  networkFreshMs: 4_000,
  statusFreshMs: 4_000,
  streamingFreshMs: 3_000,
});

const ACTIVE_STATES = new Set<CouncilChatGptState>([
  "QUEUED", "THINKING", "DEEP_THINKING", "STREAMING", "TOOL_RUNNING", "COMPLETING",
]);
const NON_RETRY_STATES = new Set<CouncilChatGptState>([
  "THINKING", "DEEP_THINKING", "STREAMING", "TOOL_RUNNING", "WAITING_USER", "COMPLETING",
  "RATE_LIMITED", "CONVERSATION_LIMIT", "DOM_DRIFT", "COMPLETED",
]);

function clean(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function newest(...values: Array<number | undefined>): number {
  return Math.max(0, ...values.filter((value): value is number => Number.isFinite(value)));
}

function evolveDomHealth(snapshot: CouncilChatGptSnapshot, previous: CouncilChatGptPreviousState, now: number): CouncilChatGptDomHealth {
  const prior = previous.domHealth ?? {};
  const sawResponse = Boolean(prior.sawResponse || snapshot.responsePresent);
  const missingResponseSince = sawResponse && !snapshot.responsePresent ? (prior.missingResponseSince ?? now) : undefined;
  const text = clean(snapshot.assistantText);
  const completionSurface = Boolean(snapshot.responsePresent && !snapshot.generationRunning && !snapshot.stopVisible);
  const emptyCompletion = completionSurface && !text && Boolean(snapshot.completionActionVisible);
  const emptyCompletionSince = emptyCompletion ? (prior.emptyCompletionSince ?? now) : undefined;
  const missingCompletionAction = completionSurface && Boolean(text) && !snapshot.completionActionVisible;
  const sameMissingText = prior.missingCompletionText === text;
  const missingCompletionActionSince = missingCompletionAction
    ? (sameMissingText ? (prior.missingCompletionActionSince ?? now) : now)
    : undefined;
  return {
    sawResponse,
    ...(missingResponseSince ? { missingResponseSince } : {}),
    ...(emptyCompletionSince ? { emptyCompletionSince } : {}),
    ...(missingCompletionActionSince ? { missingCompletionActionSince } : {}),
    ...(missingCompletionAction ? { missingCompletionText: text } : {}),
  };
}

export function deriveCouncilChatGptState(
  snapshot: CouncilChatGptSnapshot = {} as CouncilChatGptSnapshot,
  telemetry: CouncilChatGptTelemetry = {},
  previous: CouncilChatGptPreviousState = {},
  now = Date.now(),
  thresholds: Partial<CouncilChatGptThresholds> = {},
): CouncilChatGptStateResult {
  const t = { ...DEFAULT_COUNCIL_CHATGPT_THRESHOLDS, ...thresholds };
  const text = clean(snapshot.assistantText);
  const priorText = clean(previous.lastAssistantText);
  const textChanged = text !== priorText;
  const textGrew = text.length > priorText.length && text.startsWith(priorText);
  const previousActive = previous.state ? ACTIVE_STATES.has(previous.state) : false;
  const turnEstablished = Boolean(telemetry.submittedAt || previousActive);
  const progressAt = newest(
    snapshot.lastAssistantMutationAt,
    snapshot.lastStatusMutationAt,
    turnEstablished ? telemetry.lastNetworkActivityAt : undefined,
    textChanged ? now : undefined,
    previous.lastProgressAt,
  );
  const domHealth = evolveDomHealth(snapshot, previous, now);
  const evidence: string[] = [];
  const result = (
    state: CouncilChatGptState,
    confidence: number,
    reason: string,
    extra: Partial<CouncilChatGptStateResult> = {},
  ): CouncilChatGptStateResult => ({
    state,
    confidence,
    reason,
    evidence,
    lastProgressAt: progressAt || previous.lastProgressAt || 0,
    lastAssistantText: text,
    phaseStartedAt: previous.state === state ? (previous.phaseStartedAt ?? now) : now,
    domHealth,
    ...extra,
  });

  if (snapshot.conversationLimit) {
    evidence.push("conversation_limit_ui");
    return result("CONVERSATION_LIMIT", 0.99, "ChatGPT reports a conversation or context limit.");
  }
  if (snapshot.rateLimited) {
    evidence.push("rate_limit_ui");
    return result("RATE_LIMITED", 0.99, "ChatGPT reports a usage or rate limit.");
  }
  if (snapshot.connectionLost) {
    evidence.push("connection_error_ui");
    return result("CONNECTION_LOST", 0.98, "ChatGPT exposes connection-failure evidence.");
  }
  if (snapshot.terminalError) {
    evidence.push("terminal_error_ui");
    return result("FAILED", 0.98, "ChatGPT exposes terminal turn-error evidence.");
  }
  if (snapshot.waitingUser) {
    evidence.push("approval_or_user_input_required");
    return result("WAITING_USER", 0.97, "ChatGPT is waiting for explicit user approval or input.");
  }

  const networkRunning = turnEstablished && Number(telemetry.activeRequests ?? 0) > 0;
  const running = Boolean(snapshot.generationRunning || snapshot.stopVisible || networkRunning);
  const activeTool = snapshot.toolActivities?.some(activity => activity.active) ?? false;
  if (activeTool && running) {
    evidence.push("visible_tool_activity");
    if (snapshot.stopVisible) evidence.push("stop_control_visible");
    return result("TOOL_RUNNING", 0.96, "Visible tool execution is active inside the ChatGPT turn.");
  }

  if (domHealth.missingResponseSince && now - domHealth.missingResponseSince >= t.responseDomGraceMs) {
    evidence.push("response_dom_disappeared");
    return result("DOM_DRIFT", 0.94, "A response surface that previously existed disappeared beyond the DOM grace window.");
  }
  if (domHealth.emptyCompletionSince && now - domHealth.emptyCompletionSince >= t.emptyCompletionGraceMs) {
    evidence.push("empty_completion_surface");
    return result("DOM_DRIFT", 0.92, "Completion controls exist but the expected assistant content surface is empty.");
  }
  if (domHealth.missingCompletionActionSince && now - domHealth.missingCompletionActionSince >= t.completionActionGraceMs) {
    evidence.push("completion_action_missing");
    return result("DOM_DRIFT", 0.9, "A stable answer exists but the expected completion controls did not appear within grace.");
  }

  const completionReady = Boolean(snapshot.responsePresent && !running && text && snapshot.completionActionVisible);
  if (completionReady) {
    evidence.push("response_present", "generation_not_running", "non_empty_answer", "completion_action_visible");
    const signature = `${text}\0${snapshot.responseSignature ?? text}`;
    const candidate = previous.completionCandidate?.signature === signature
      ? previous.completionCandidate
      : { signature, since: now };
    if (now - candidate.since >= t.completionSettleMs) {
      evidence.push("completion_stable");
      return result("COMPLETED", 0.995, "The assistant answer and completion surface remained stable across the settle window.", { completionCandidate: candidate });
    }
    return result("COMPLETING", 0.92, "Completion evidence is present; waiting for a stable signature before committing completion.", { completionCandidate: candidate });
  }

  const freshNetwork = turnEstablished && now - Number(telemetry.lastNetworkActivityAt ?? 0) <= t.networkFreshMs;
  const freshStatus = now - Number(snapshot.lastStatusMutationAt ?? 0) <= t.statusFreshMs;
  const freshText = textChanged || now - Number(snapshot.lastAssistantMutationAt ?? 0) <= t.streamingFreshMs;

  if (running) {
    if (snapshot.stopVisible) evidence.push("stop_control_visible");
    if (freshNetwork) evidence.push("fresh_network_pulse");
    if (freshStatus) evidence.push("fresh_status_pulse");
    if (freshText && text) evidence.push("fresh_answer_pulse");
    if (textGrew || (text && freshText)) return result("STREAMING", 0.95, "Assistant content is actively changing.");

    const baseline = progressAt || telemetry.submittedAt || previous.lastProgressAt || now;
    const quietFor = Math.max(0, now - baseline);
    const hasFreshProgress = freshNetwork || freshStatus || (freshText && Boolean(text));
    if (snapshot.stopVisible && !hasFreshProgress && quietFor >= t.deepThinkingMs) {
      evidence.push("long_quiet_with_stop_control");
      return result("DEEP_THINKING", 0.91, "The turn is quiet but still owns a live generation control; do not retry.");
    }
    if (snapshot.stopVisible || hasFreshProgress) return result("THINKING", 0.94, "The turn still has positive liveness evidence.");
    if (quietFor >= t.stallMs) {
      evidence.push("liveness_timeout");
      return result("STALLED", 0.82, "The active turn has no progress evidence beyond the stall threshold.");
    }
    return result("THINKING", 0.82, "The turn appears active but has not yet accumulated enough evidence for another state.");
  }

  if (telemetry.submittedAt && !snapshot.responsePresent) {
    evidence.push("submission_recorded");
    const quietFor = now - telemetry.submittedAt;
    if (quietFor >= t.stallMs) return result("STALLED", 0.8, "The prompt was submitted but no response surface appeared before the stall threshold.");
    return result("QUEUED", 0.84, "The prompt was submitted and Council is waiting for the response surface.");
  }
  if (clean(snapshot.composerText)) {
    evidence.push("composer_has_text");
    return result("DISCOVERED", 0.8, "The ChatGPT surface is present with unsent composer content.");
  }
  if (snapshot.composerPresent) {
    evidence.push("composer_visible");
    return result("IDLE", 0.97, "The ChatGPT composer is visible and ready for a new turn.");
  }
  evidence.push("surface_incomplete");
  return result("DISCOVERED", 0.55, "The browser surface exists but ChatGPT readiness is not yet proven.");
}

export function councilChatGptMayRetry(state: Pick<CouncilChatGptStateResult, "state" | "evidence">): boolean {
  if (NON_RETRY_STATES.has(state.state)) return false;
  if (state.evidence.some(item => ["stop_control_visible", "fresh_network_pulse", "fresh_status_pulse", "fresh_answer_pulse"].includes(item))) return false;
  return state.state === "CONNECTION_LOST" || state.state === "FAILED" || state.state === "STALLED";
}
