import type { CouncilBrowserAction } from "./browser-actions";
import type { CouncilPermission, ManagedAgentRecord } from "./managed-agent-state";

const REQUIRED: Partial<Record<CouncilBrowserAction["type"], CouncilPermission>> = {
  SPAWN_AGENT: "spawn",
  WAKE: "wake",
  FINAL_DECISION: "finalize",
  CREATE_TASK: "assign",
  REQUEST_REVIEW: "assign",
};

export function assertBrowserActionPermission(agent: Pick<ManagedAgentRecord, "id" | "permissions">, action: CouncilBrowserAction): void {
  let required = REQUIRED[action.type];
  if (action.type === "UPDATE_TASK" && action.assignee_agent_id !== undefined) required = "assign";
  if (required && !agent.permissions.includes(required)) throw new Error(`Council agent ${agent.id} requires ${required} permission for ${action.type}`);
}
