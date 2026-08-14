export type CouncilBrowserAction =
  | { type: "SAY"; room_id: string; body: string; mentions?: string[] }
  | { type: "PROPOSE"; room_id: string; body: string; mentions?: string[] }
  | { type: "REPLY"; room_id: string; reply_to: string; body: string; mentions?: string[] }
  | { type: "WAKE"; room_id: string; target_agent_id: string; reason: string; source_message_id?: string }
  | { type: "SPAWN_AGENT"; name: string; role: string; mandate: string; requested_agent_id?: string }
  | { type: "CREATE_TASK"; room_id: string; title: string; description: string; assignee_agent_id?: string }
  | { type: "UPDATE_TASK"; task_id: string; status: "todo" | "claimed" | "in_progress" | "review" | "done" | "blocked"; assignee_agent_id?: string }
  | { type: "REQUEST_REVIEW"; room_id: string; task_id: string; reviewer_agent_id: string; reason: string }
  | { type: "FINAL_DECISION"; room_id: string; title: string; policy: string; rationale: string; accepted_arguments?: string[]; rejected_arguments?: string[]; unresolved_risks?: string[] }
  | { type: "CHECKPOINT"; room_id?: string; summary: string }
  | { type: "SLEEP" };

export interface CouncilActionBatch { version: 1; actions: CouncilBrowserAction[] }
export interface ParsedCouncilActionFooter { visibleText: string; batch: CouncilActionBatch }

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_ACTIONS = 16;
const MAX_JSON_CHARS = 64 * 1024;
const schemas: Record<CouncilBrowserAction["type"], { required: readonly string[]; optional: readonly string[] }> = {
  SAY: { required: ["type", "room_id", "body"], optional: ["mentions"] },
  PROPOSE: { required: ["type", "room_id", "body"], optional: ["mentions"] },
  REPLY: { required: ["type", "room_id", "reply_to", "body"], optional: ["mentions"] },
  WAKE: { required: ["type", "room_id", "target_agent_id", "reason"], optional: ["source_message_id"] },
  SPAWN_AGENT: { required: ["type", "name", "role", "mandate"], optional: ["requested_agent_id"] },
  CREATE_TASK: { required: ["type", "room_id", "title", "description"], optional: ["assignee_agent_id"] },
  UPDATE_TASK: { required: ["type", "task_id", "status"], optional: ["assignee_agent_id"] },
  REQUEST_REVIEW: { required: ["type", "room_id", "task_id", "reviewer_agent_id", "reason"], optional: [] },
  FINAL_DECISION: { required: ["type", "room_id", "title", "policy", "rationale"], optional: ["accepted_arguments", "rejected_arguments", "unresolved_risks"] },
  CHECKPOINT: { required: ["type", "summary"], optional: ["room_id"] },
  SLEEP: { required: ["type"], optional: [] },
};

export function validateCouncilActionBatch(value: unknown): CouncilActionBatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Council action batch must be an object");
  const batch = value as Record<string, unknown>;
  for (const key of Object.keys(batch)) if (key !== "actions" && key !== "version") throw new Error(`unknown batch field: ${key}`);
  if (batch.version !== undefined && batch.version !== 1) throw new Error("unsupported Council action version");
  if (!Array.isArray(batch.actions)) throw new Error("Council action batch requires actions");
  if (batch.actions.length > MAX_ACTIONS) throw new Error(`Council action batch exceeds ${MAX_ACTIONS} actions`);
  return { version: 1, actions: batch.actions.map(validateAction) };
}

function validateAction(value: unknown): CouncilBrowserAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Council action must be an object");
  const action = value as Record<string, unknown>;
  const type = action.type;
  if (typeof type !== "string" || !(type in schemas)) throw new Error(`unknown Council action type: ${String(type)}`);
  const schema = schemas[type as CouncilBrowserAction["type"]];
  const allowed = new Set([...schema.required, ...schema.optional]);
  for (const key of Object.keys(action)) if (!allowed.has(key)) throw new Error(`unknown field ${key} on ${type}`);
  for (const key of schema.required) if (!(key in action)) throw new Error(`missing field ${key} on ${type}`);
  for (const key of ["room_id", "reply_to", "target_agent_id", "source_message_id", "requested_agent_id", "assignee_agent_id", "task_id", "reviewer_agent_id"] as const) {
    const candidate = action[key];
    if (candidate !== undefined && (typeof candidate !== "string" || !ID.test(candidate.trim()))) throw new Error(`${key} is invalid`);
  }
  for (const key of ["body", "reason", "name", "role", "mandate", "title", "description", "policy", "rationale", "summary"] as const) {
    const candidate = action[key];
    if (candidate !== undefined && (typeof candidate !== "string" || !candidate.trim())) throw new Error(`${key} must be non-empty text`);
  }
  if (action.status !== undefined && !["todo", "claimed", "in_progress", "review", "done", "blocked"].includes(String(action.status))) throw new Error("task status is invalid");
  for (const key of ["mentions", "accepted_arguments", "rejected_arguments", "unresolved_risks"] as const) {
    const candidate = action[key];
    if (candidate !== undefined && (!Array.isArray(candidate) || candidate.some(item => typeof item !== "string" || !item.trim()))) throw new Error(`${key} must be a string array`);
  }
  return structuredClone(action) as CouncilBrowserAction;
}

export function assertCouncilActionJsonSize(json: string): void {
  if (json.length > MAX_JSON_CHARS) throw new Error(`Council action JSON exceeds ${MAX_JSON_CHARS} characters`);
}
