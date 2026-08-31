import type { BrowserState, CouncilRuntimeViewState } from "./types";

export type CouncilConnectionStatus = "healthy" | "degraded" | "unverified" | "offline" | "blocked";
export type CouncilConnectorObservation = "verified" | "missing" | "unknown";

export interface CouncilConnectionNode {
  id: "tunnel" | "runtime" | "mcp" | "connector" | "playwright" | "chatgpt";
  label: string;
  status: CouncilConnectionStatus;
  detail: string;
  evidence: string;
  repair: string;
}

const NO_ACTION = "No action required.";

function capabilityNode(
  id: "tunnel" | "mcp",
  label: string,
  capability: CouncilRuntimeViewState["capabilities"]["secureTunnel"],
  fallback: string,
  repair: string,
): CouncilConnectionNode {
  if (capability.available && capability.state === "ready") return { id, label, status: "healthy", detail: "Ready", evidence: "Live runtime capability evidence", repair: NO_ACTION };
  if (capability.state === "starting") return { id, label, status: "unverified", detail: "Starting", evidence: capability.reason?.code ?? fallback, repair };
  if (capability.state === "degraded") return { id, label, status: "degraded", detail: "Degraded", evidence: capability.reason?.code ?? fallback, repair };
  if (capability.state === "error") return { id, label, status: "offline", detail: "Unavailable", evidence: capability.reason?.code ?? fallback, repair };
  return { id, label, status: "offline", detail: "Offline", evidence: capability.reason?.code ?? fallback, repair };
}

export function deriveCouncilConnections(input: {
  runtime: CouncilRuntimeViewState;
  browser: BrowserState | null;
  connectorObservation?: CouncilConnectorObservation;
}): CouncilConnectionNode[] {
  const { runtime, browser } = input;
  const connectorObservation = input.connectorObservation ?? "unknown";
  const tunnel = capabilityNode(
    "tunnel",
    "Secure Tunnel",
    runtime.capabilities.secureTunnel,
    "No live Tunnel evidence",
    "Reconnect the secure tunnel and inspect its event log.",
  );
  const mcp = capabilityNode(
    "mcp",
    "MCP runtime",
    runtime.capabilities.fullMcp,
    "No live MCP capability evidence",
    "Run runtime doctor, then restart the Council MCP runtime if it remains unavailable.",
  );

  const runtimeNode: CouncilConnectionNode = runtime.controlPlane.state === "connected" && runtime.projection.syncState === "live"
    ? { id: "runtime", label: "Council runtime", status: "healthy", detail: "Live", evidence: "Control plane connected and projection synchronized", repair: NO_ACTION }
    : runtime.controlPlane.state === "connected" && runtime.projection.syncState === "stale"
      ? { id: "runtime", label: "Council runtime", status: "degraded", detail: "Stale", evidence: runtime.projection.reason.code, repair: "Run runtime doctor and restart the local Council runtime if synchronization does not recover." }
      : runtime.controlPlane.state === "degraded"
        ? { id: "runtime", label: "Council runtime", status: "degraded", detail: "Degraded", evidence: runtime.controlPlane.reason?.code ?? "Control plane degraded", repair: "Run runtime doctor and inspect the control-plane event timeline." }
        : runtime.controlPlane.state === "connecting"
          ? { id: "runtime", label: "Council runtime", status: "unverified", detail: "Connecting", evidence: "Waiting for synchronized Council state", repair: "Wait for synchronization; run runtime doctor if the connection remains in this state." }
          : { id: "runtime", label: "Council runtime", status: "offline", detail: "Offline", evidence: runtime.controlPlane.reason?.code ?? "Control plane unreachable", repair: "Run runtime doctor and restart the local Council runtime." };

  const connector: CouncilConnectionNode = connectorObservation === "verified"
    ? { id: "connector", label: "ChatGPT connector", status: "healthy", detail: "Verified", evidence: "Exact CodexWeb Council connector observed this session", repair: NO_ACTION }
    : connectorObservation === "missing"
      ? { id: "connector", label: "ChatGPT connector", status: "degraded", detail: "Not visible", evidence: "Exact connector was not observed; browser-only Council remains available", repair: "Refresh connector catalog or open ChatGPT connector settings; browser-only Council can continue." }
      : { id: "connector", label: "ChatGPT connector", status: "unverified", detail: "Not checked", evidence: "Connector state has not been probed in this launcher session", repair: "Refresh connector catalog to verify whether CodexWeb Council is visible." };

  const playwright: CouncilConnectionNode = browser
    ? browser.status === "error"
      ? { id: "playwright", label: "Playwright surfaces", status: "degraded", detail: "Degraded", evidence: `Electron browser host reports ${browser.maxTabs} surface slot(s)`, repair: "Open the ChatGPT browser and run managed-surface diagnostics." }
      : { id: "playwright", label: "Playwright surfaces", status: "healthy", detail: "Available", evidence: `Electron browser host reports ${browser.maxTabs} surface slot(s)`, repair: NO_ACTION }
    : { id: "playwright", label: "Playwright surfaces", status: "offline", detail: "Unavailable", evidence: "No launcher browser host snapshot", repair: "Open the ChatGPT browser and restart the Electron browser host." };

  const chatgpt: CouncilConnectionNode = !browser
    ? { id: "chatgpt", label: "ChatGPT session", status: "unverified", detail: "Unknown", evidence: "Browser host unavailable", repair: "Open the ChatGPT browser to establish session evidence." }
    : browser.authenticated
      ? { id: "chatgpt", label: "ChatGPT session", status: "healthy", detail: "Signed in", evidence: "Authenticated Electron profile", repair: NO_ACTION }
      : { id: "chatgpt", label: "ChatGPT session", status: "blocked", detail: "Sign in required", evidence: browser.message || "No authenticated ChatGPT session", repair: "Sign in to ChatGPT in the owned Electron browser." };

  return [tunnel, runtimeNode, mcp, connector, playwright, chatgpt];
}
