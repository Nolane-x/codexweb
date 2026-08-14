import { useEffect, useMemo, useState } from "react";
import type { BrowserState } from "./types";

const ENDPOINT = "http://127.0.0.1:17842/api/state";

type RuntimeStatus = "active" | "sleeping" | "queued" | "failed";
interface ManagedProject { roomId: string; name: string; mission: string; leadAgentId: string }
interface ManagedAgent {
  id: string;
  name: string;
  role: string;
  mandate: string;
  permissions: string[];
  conversationBound: boolean;
  checkpointSaved: boolean;
  runtimeStatus: RuntimeStatus;
}
interface ManagedSnapshot { project: ManagedProject | null; agents: ManagedAgent[] }

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "AI";
}

export function CouncilAgentsPanel() {
  const [open, setOpen] = useState(false);
  const [managed, setManaged] = useState<ManagedSnapshot | null>(null);
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [online, setOnline] = useState(false);
  const [binding, setBinding] = useState(false);
  const [bindMessage, setBindMessage] = useState("");
  const [projectName, setProjectName] = useState("ChatGPT Project");

  useEffect(() => {
    const api = window.codexWebLauncher;
    if (!api) return;
    let disposed = false;
    void api.snapshot().then(snapshot => { if (!disposed) setBrowser(snapshot.browser); }).catch(() => {});
    const unsubscribe = api.onBrowserState(setBrowser);
    return () => { disposed = true; unsubscribe(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller?.abort();
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 1_800);
      try {
        const response = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const value = await response.json() as { managed?: ManagedSnapshot | null };
        if (!disposed) { setManaged(value.managed ?? null); setOnline(true); }
      } catch {
        if (!disposed) setOnline(false);
      } finally { window.clearTimeout(timeout); }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1_500);
    return () => { disposed = true; controller?.abort(); window.clearInterval(interval); };
  }, []);

  const tabByAgent = useMemo(() => new Map((browser?.tabs ?? []).filter(tab => tab.agentId).map(tab => [tab.agentId!, tab])), [browser]);

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
    if (!api || binding) return;
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
      <button className={`council-agents-launch${open ? " is-open" : ""}`} onClick={() => setOpen(value => !value)} type="button" title="Managed ChatGPT agents">
        <span>AI</span><strong>Agents</strong><i className={online ? "online" : "offline"} />
      </button>
      {open ? (
        <section className="council-agents-panel" role="dialog" aria-label="Managed ChatGPT agents">
          <header>
            <div><span>Electron team</span><strong>{managed?.project?.name ?? "No managed project"}</strong></div>
            <button onClick={() => setOpen(false)} aria-label="Close managed agents">×</button>
          </header>
          {managed?.project ? (
            <div className="council-agents-project">
              <span>#{managed.project.roomId}</span>
              <p>{managed.project.mission}</p>
              <small>Lead · {managed.project.leadAgentId}</small>
            </div>
          ) : (
            <div className="council-agents-empty">
              <strong>Start with your current ChatGPT conversation</strong>
              <p>Open the persistent Project chat you want to lead this Council. Electron reads that exact conversation URL itself; it is never accepted from page content.</p>
              <input value={projectName} onChange={event => setProjectName(event.target.value)} maxLength={160} placeholder="Project name" />
              <button type="button" disabled={binding || browser?.authenticated !== true || !online} onClick={() => void bindLead()}>
                {binding ? "Binding…" : "Bind current ChatGPT as Lead"}
              </button>
              {!online ? <small>Connect the Council Tunnel first so the local Council runtime is online.</small> : null}
              {browser?.authenticated !== true ? <small>Sign in to ChatGPT in Electron first.</small> : null}
              {bindMessage ? <small>{bindMessage}</small> : null}
            </div>
          )}
          <div className="council-agents-list">
            {(managed?.agents ?? []).map(agent => {
              const tab = tabByAgent.get(agent.id);
              return (
                <button className="council-agent-row" key={agent.id} disabled={!tab} onClick={() => void openAgent(agent.id)} type="button">
                  <span className="council-agent-row-avatar">{initials(agent.name)}<i className={agent.runtimeStatus} /></span>
                  <span className="council-agent-row-copy"><strong>{agent.name}</strong><small>{agent.role}</small><em>{agent.mandate}</em></span>
                  <span className="council-agent-row-meta"><b>{agent.runtimeStatus}</b><small>{agent.conversationBound ? "conversation saved" : "new conversation"}</small>{tab ? <small>open ChatGPT ↗</small> : null}</span>
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
