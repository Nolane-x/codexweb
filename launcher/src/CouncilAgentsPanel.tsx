import { useEffect, useMemo, useState } from "react";
import { effectivePresenceFreshness, presenceLabel } from "./council-presence";
import type { BrowserState, CouncilRuntimeViewState, ManagedCouncilView } from "./types";

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "AI";
}

function managedSnapshot(runtime: CouncilRuntimeViewState | null): ManagedCouncilView | null {
  if (runtime?.projection.syncState === "live" || runtime?.projection.syncState === "stale") return runtime.projection.state.managed;
  return null;
}

function sharedPresence(runtime: CouncilRuntimeViewState | null) {
  if (runtime?.projection.syncState === "live" || runtime?.projection.syncState === "stale") return runtime.projection.state.presence;
  return [];
}

function shortCommit(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}

export function CouncilAgentsPanel() {
  const [open, setOpen] = useState(false);
  const [runtime, setRuntime] = useState<CouncilRuntimeViewState | null>(null);
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [binding, setBinding] = useState(false);
  const [bindMessage, setBindMessage] = useState("");
  const [projectName, setProjectName] = useState("ChatGPT Project");
  const [presenceClockMs, setPresenceClockMs] = useState(() => Date.now());

  useEffect(() => {
    const api = window.codexWebLauncher;
    if (!api) return;
    let disposed = false;
    void api.snapshot().then(snapshot => {
      if (disposed) return;
      setBrowser(snapshot.browser);
      setRuntime(snapshot.councilRuntime);
    }).catch(() => {});
    const offBrowser = api.onBrowserState(setBrowser);
    const offCouncil = api.onCouncilRuntime(setRuntime);
    return () => { disposed = true; offBrowser(); offCouncil(); };
  }, []);

  useEffect(() => {
    if (!open) return;
    setPresenceClockMs(Date.now());
    const timer = window.setInterval(() => setPresenceClockMs(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [open]);

  const managed = managedSnapshot(runtime);
  const workspace = managed?.project?.workspace;
  const sharedLive = runtime?.projection.syncState === "live";
  const sharedStale = runtime?.projection.syncState === "stale";
  const managedProject = runtime?.managedProject;
  const capabilities = runtime?.capabilities;
  const tabByAgent = useMemo(() => new Map((browser?.tabs ?? []).filter(tab => tab.agentId).map(tab => [tab.agentId!, tab])), [browser]);
  const presenceByAgent = useMemo(() => new Map(sharedPresence(runtime).map(presence => [presence.agentId, presence])), [runtime]);
  const canBind = sharedLive && managedProject?.state === "unattached" && browser?.authenticated === true;

  const openAgent = async (agentId: string) => {
    const api = window.codexWebLauncher;
    const tab = tabByAgent.get(agentId);
    if (!api || !tab) return;
    setOpen(false);
    await api.setBrowserSurfaceActive(true);
    await api.selectBrowserTab(tab.id);
    await api.showBrowser();
  };

  const bindLead = async () => {
    const api = window.codexWebLauncher;
    if (!api || binding || !canBind) return;
    setBinding(true);
    setBindMessage("Binding the current persistent ChatGPT conversation…");
    try {
      const result = await api.bindCurrentChatGptAsLead({ projectName: projectName.trim() || "ChatGPT Project" });
      setBindMessage(`Lead ${result.lead.name} is bound. The Council bootstrap turn has been sent.`);
    } catch (error) {
      setBindMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBinding(false);
    }
  };

  return (
    <>
      <button className={`council-agents-launch${open ? " is-open" : ""}`} onClick={() => setOpen(value => !value)} type="button" title={sharedLive ? "Shared Council sync is live" : "Shared Council sync is unavailable or reconnecting"}>
        <span>AI</span><strong>Agents</strong><i className={sharedLive ? "online" : "offline"} />
      </button>
      {open ? (
        <section className="council-agents-panel" role="dialog" aria-label="Managed ChatGPT agents">
          <header>
            <div><span>Electron team · {sharedStale ? "reconnecting" : sharedLive ? "shared live" : "sync unavailable"}</span><strong>{managed?.project?.name ?? "No managed project"}</strong></div>
            <button onClick={() => setOpen(false)} aria-label="Close managed agents">×</button>
          </header>
          {managed?.project ? (
            <>
              <div className="council-agents-project">
                <span>#{managed.project.roomId}</span>
                <p>{managed.project.mission}</p>
                <small>Lead · {managed.project.leadAgentId}</small>
              </div>
              {workspace ? (
                <div className="council-agents-project">
                  <span>GitHub workspace</span>
                  <p>{workspace.owner}/{workspace.name}</p>
                  <small>{workspace.defaultBranch} · pinned {shortCommit(workspace.baseCommit)}</small>
                </div>
              ) : null}
            </>
          ) : (
            <div className="council-agents-empty">
              <strong>Start with your current ChatGPT conversation</strong>
              <p>Open the persistent Project chat you want to lead this Council. Electron reads that exact conversation URL itself; it is never accepted from page content.</p>
              <input value={projectName} onChange={event => setProjectName(event.target.value)} maxLength={160} placeholder="Project name" />
              <button type="button" disabled={binding || !canBind} onClick={() => void bindLead()}>
                {binding ? "Binding…" : "Bind current ChatGPT as Lead"}
              </button>
              {!sharedLive ? <small>Attaching a project requires a live canonical Council session. Existing shared data stays visible while reconnecting.</small> : null}
              {browser?.authenticated !== true ? <small>Sign in to ChatGPT in Electron first.</small> : null}
              {capabilities && !capabilities.secureTunnel.available ? <small>Secure Tunnel is unavailable; only actions that require it are disabled.</small> : null}
              {bindMessage ? <small>{bindMessage}</small> : null}
            </div>
          )}
          <div className="council-agents-list">
            {(managed?.agents ?? []).map(agent => {
              const tab = tabByAgent.get(agent.id);
              const presenceFreshness = effectivePresenceFreshness(presenceByAgent.get(agent.id), presenceClockMs);
              return (
                <button className="council-agent-row" key={agent.id} disabled={!tab} onClick={() => void openAgent(agent.id)} type="button">
                  <span className="council-agent-row-avatar">{initials(agent.name)}<i className={`presence-${presenceFreshness}`} title={`Council presence: ${presenceLabel(presenceFreshness)}`} /></span>
                  <span className="council-agent-row-copy"><strong>{agent.name}</strong><small>{agent.role}</small><em>{agent.mandate}</em></span>
                  <span className="council-agent-row-meta"><b>{presenceLabel(presenceFreshness)}</b><small>runtime {agent.runtimeStatus}</small><small>{agent.conversationBound ? "conversation saved" : "new conversation"}</small>{tab ? <small>open ChatGPT ↗</small> : null}</span>
                </button>
              );
            })}
          </div>
          {managed?.agents.length ? <footer>{managed.agents.length} registered · {tabByAgent.size}/5 browser surfaces currently bound</footer> : null}
        </section>
      ) : null}
    </>
  );
}
