import type { CouncilPermission } from "./managed-agent-state";

export type CouncilExecutionCommand =
  | { type: "cancel"; runId: string }
  | { type: "focus"; agentId: string }
  | { type: "capture"; agentId: string }
  | { type: "retry"; runId: string };

export function requiredCouncilExecutionPermission(command: CouncilExecutionCommand): CouncilPermission {
  switch (command.type) {
    case "focus":
    case "capture":
      return "review";
    case "cancel":
    case "retry":
      return "wake";
  }
}

export function assertCouncilExecutionPermission(
  actor: { id: string; permissions: readonly CouncilPermission[] } | undefined,
  command: CouncilExecutionCommand,
): CouncilPermission {
  if (!actor) throw new Error("Council execution commands require a managed Council participant");
  const required = requiredCouncilExecutionPermission(command);
  if (!actor.permissions.includes(required)) {
    throw new Error(`Council agent ${actor.id} requires ${required} permission for execution ${command.type}`);
  }
  return required;
}
