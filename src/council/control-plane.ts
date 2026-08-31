export interface CouncilControlPlaneAvailability {
  managedRuntime?: boolean;
  wakeDelivery?: boolean;
  observations?: boolean;
  autonomy?: boolean;
  memory?: boolean;
}

export interface CouncilCapabilityManifest {
  version: 2;
  protocol: "CodexWeb Council Control Plane";
  compatibility: "additive-v2";
  capabilities: {
    discussion: true;
    work: true;
    managedAgents: boolean;
    browserAutomation: boolean;
    browserOnlyCouncil: boolean;
    wakeDelivery: boolean;
    observations: boolean;
    autonomy: boolean;
    memory: boolean;
    chatGptConnector: {
      mode: "optional";
      requiredForManagedTurns: false;
      healthAuthority: "electron-chatgpt-surface";
    };
  };
}

export function buildCouncilCapabilityManifest(input: CouncilControlPlaneAvailability = {}): CouncilCapabilityManifest {
  const managed = input.managedRuntime === true;
  return {
    version: 2,
    protocol: "CodexWeb Council Control Plane",
    compatibility: "additive-v2",
    capabilities: {
      discussion: true,
      work: true,
      managedAgents: managed,
      browserAutomation: managed,
      browserOnlyCouncil: managed,
      wakeDelivery: input.wakeDelivery === true,
      observations: input.observations === true,
      autonomy: input.autonomy === true,
      memory: input.memory === true,
      chatGptConnector: { mode: "optional", requiredForManagedTurns: false, healthAuthority: "electron-chatgpt-surface" },
    },
  };
}

export interface CouncilSystemStatusInput {
  council: { rooms: number; agents: number; tasksOpen: number; activeWakes: number; decisions: number };
  managedProject?: { roomId: string; name: string; leadAgentId: string } | null;
  managedAgents?: Array<{ id: string; name: string; role: string; runtimeStatus: string; conversationBound: boolean; checkpointSaved: boolean }>;
  autonomy?: { running: boolean; activeWork: number; exceptionalWork: number; breakerOpenCount: number } | null;
  memory?: { entries: number; oldestAt: string | null; newestAt: string | null } | null;
}

export interface CouncilSystemStatus {
  version: 2;
  council: CouncilSystemStatusInput["council"];
  project: CouncilSystemStatusInput["managedProject"];
  managedAgents: NonNullable<CouncilSystemStatusInput["managedAgents"]>;
  autonomy: CouncilSystemStatusInput["autonomy"];
  memory: CouncilSystemStatusInput["memory"];
}

export function buildCouncilSystemStatus(input: CouncilSystemStatusInput): CouncilSystemStatus {
  return {
    version: 2,
    council: { ...input.council },
    project: input.managedProject ? { ...input.managedProject } : null,
    managedAgents: (input.managedAgents ?? []).map(agent => ({ ...agent })),
    autonomy: input.autonomy ? { ...input.autonomy } : null,
    memory: input.memory ? { ...input.memory } : null,
  };
}

export type CouncilDiagnosticStatus = "ready" | "degraded" | "unverified" | "unavailable";
export interface CouncilDiagnosticCheck { id: string; label: string; status: CouncilDiagnosticStatus; evidence: string; nextAction: string }
export interface CouncilDiagnosticInput extends CouncilControlPlaneAvailability { autonomyRunning?: boolean; activeProject?: boolean; managedAgentCount?: number }
export interface CouncilDiagnosticReport { version: 2; checks: CouncilDiagnosticCheck[]; blocking: string[] }

export function buildCouncilDiagnosticReport(input: CouncilDiagnosticInput): CouncilDiagnosticReport {
  const managed = input.managedRuntime === true;
  const checks: CouncilDiagnosticCheck[] = [
    {
      id: "mcp-runtime", label: "Council MCP runtime", status: "ready",
      evidence: "This diagnostic was produced by the authenticated Council MCP server.", nextAction: "No action required.",
    },
    {
      id: "managed-project", label: "Managed Council project",
      status: managed && input.activeProject ? "ready" : managed ? "degraded" : "unavailable",
      evidence: managed ? input.activeProject ? "An Electron-managed Council project is active." : "Managed runtime exists but no project is active." : "No Electron-managed runtime was attached to this MCP server.",
      nextAction: managed && !input.activeProject ? "Bind or start the intended Lead project conversation." : managed ? "No action required." : "Start Council from the Electron application to enable managed agents.",
    },
    {
      id: "browser-control", label: "Playwright browser control", status: managed ? "ready" : "unavailable",
      evidence: managed ? `Managed browser transport is registered for ${Math.max(0, input.managedAgentCount ?? 0)} persisted agent(s).` : "Browser automation is not attached to this MCP process.",
      nextAction: managed ? "Managed turns may continue with browser-only Council even when the ChatGPT connector is absent." : "Start the Electron managed runtime.",
    },
    {
      id: "chatgpt-connector", label: "ChatGPT MCP connector", status: "unverified",
      evidence: managed ? "The connector is optional for managed turns; this MCP process is not the authority for the current ChatGPT composer catalog." : "Connector presence must be verified inside the active ChatGPT surface.",
      nextAction: managed ? "Use browser-only Council now; verify or repair the connector separately for MCP-enhanced turns." : "Open the Electron ChatGPT surface and verify the CodexWeb Council connector there.",
    },
    {
      id: "wake-delivery", label: "Wake delivery", status: input.wakeDelivery ? "ready" : "degraded",
      evidence: input.wakeDelivery ? "A Council wake-delivery transport is registered." : "No asynchronous wake-delivery transport is registered.",
      nextAction: input.wakeDelivery ? "No action required." : "Keep wakes durable and attach the managed Electron delivery transport when available.",
    },
    {
      id: "autonomy", label: "Durable autonomy", status: !input.autonomy ? "unavailable" : input.autonomyRunning ? "ready" : "degraded",
      evidence: !input.autonomy ? "Autonomy kernel is not registered." : input.autonomyRunning ? "Durable autonomy dispatcher is running." : "Autonomy kernel exists but its dispatcher is not running.",
      nextAction: !input.autonomy ? "Start Council with the autonomy kernel for restart-safe work." : input.autonomyRunning ? "No action required." : "Restart or diagnose the Council autonomy dispatcher.",
    },
    {
      id: "project-memory", label: "Project memory", status: input.memory ? "ready" : "unavailable",
      evidence: input.memory ? "Bounded provenance-preserving Council memory is registered." : "Project memory is not attached to this MCP process.",
      nextAction: input.memory ? "No action required." : "Enable the Council memory index for long-horizon project continuity.",
    },
  ];
  return {
    version: 2,
    checks,
    blocking: checks.filter(check => check.status === "unavailable" && ["mcp-runtime", "managed-project", "browser-control"].includes(check.id)).map(check => check.id),
  };
}
