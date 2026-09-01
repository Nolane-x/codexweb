import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { BrowserState, CouncilAutonomyStatusView, CouncilExecutionRunView, CouncilRuntimeViewState, CouncilSupervisorStatusView, LauncherSnapshot, LogRecord, ManagedAgentView } from "./types";
import { deriveCouncilConnections, type CouncilConnectionNode, type CouncilConnectorObservation } from "./councilConnectionModel";
import { ExecutionBadge, ExecutionInspector, executionByAgent, useCouncilExecutionRuns } from "./CouncilExecutionInspector";
import "./council-shell.css";
import "./council-36.css";

type CouncilExceptionalWorkView = {
  id: string; kind: string; projectRoomId: string; targetAgentId?: string; taskId?: string;
  state: "uncertain" | "failed"; attempt: number; maxAttempts: number; lastPhase?: string;
  failureCode?: string; failureMessage?: string; correlationId: string; createdAt: string; updatedAt: string; reasons: string[];
};
type CouncilMemoryView = { id: string; projectRoomId: string; sourceType: string; sourceId: string; text: string; agentIds: string[]; taskIds: string[]; updatedAt: string; score: number; provenance: { sourceType: string; sourceId: string } };
type CouncilMemoryStatsView = { entries: number; oldestAt: string | null; newestAt: string | null };
type CouncilEvidenceStatsView = { blobs: number; references: number; bytes: number; maxBytes: number; overBudget: boolean } | null;
type Council36Api = {
  councilAutonomyStatus(): Promise<CouncilAutonomyStatusView & { exceptionalCount?: number }>;
  councilExceptionalWork(): Promise<CouncilExceptionalWorkView[]>;
  cancelCouncilExceptionalWork(workItemId: string): Promise<unknown>;
  retryCouncilUncertainWork(workItemId: string): Promise<unknown>;
  councilMemoryStats(roomId?: string | null): Promise<CouncilMemoryStatsView>;
  councilMemorySearch(roomId: string, query: string, limit?: number): Promise<CouncilMemoryView[]>;
  councilMemoryRecent(roomId: string, limit?: number): Promise<CouncilMemoryView[]>;
  clearCouncilProjectMemory(roomId: string): Promise<{ deleted: number }>;
  councilObservationStorage(): Promise<CouncilEvidenceStatsView>;
};

const api = window.codexWebLauncher;
const api36 = api as (typeof api & Council36Api);
type View = "overview" | "chatgpt" | "agents" | "work" | "executions" | "memory" | "connections" | "diagnostics" | "settings";

const NAV: Array<{ id: View; label: string; hint: string; group: "workspace" | "intelligence" | "system" }> = [
  { id: "overview", label: "Overview", hint: "Mission and attention", group: "workspace" },
  { id: "chatgpt", label: "ChatGPT", hint: "Persistent conversations", group: "workspace" },
  { id: "agents", label: "Agents", hint: "Team and capability", group: "workspace" },
  { id: "work", label: "Work", hint: "Tasks and autonomy", group: "workspace" },
  { id: "executions", label: "Executions", hint: "Live browser control", group: "workspace" },
  { id: "memory", label: "Memory", hint: "Provenance knowledge", group: "intelligence" },
  { id: "connections", label: "Connections", hint: "Transport truth", group: "system" },
  { id: "diagnostics", label: "Diagnostics", hint: "Evidence and repair", group: "system" },
  { id: "settings", label: "Settings", hint: "Desktop behavior", group: "system" },
];

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function managedAgents(runtime: CouncilRuntimeViewState | null): ManagedAgentView[] {
  if (runtime?.projection.syncState !== "live" && runtime?.projection.syncState !== "stale") return [];
  return runtime.projection.state.managed?.agents ?? [];
}
function autonomyStatus(runtime: CouncilRuntimeViewState | null): CouncilAutonomyStatusView | null {
  if (runtime?.projection.syncState !== "live" && runtime?.projection.syncState !== "stale") return null;
  return runtime.projection.state.managed?.autonomy ?? null;
}
function projectRoomId(runtime: CouncilRuntimeViewState | null): string | null {
  if (runtime?.projection.syncState !== "live" && runtime?.projection.syncState !== "stale") return null;
  return runtime.projection.state.managed?.project?.roomId ?? null;
}
function managedProject(runtime: CouncilRuntimeViewState | null) {
  if (runtime?.projection.syncState !== "live" && runtime?.projection.syncState !== "stale") return null;
  return runtime.projection.state.managed?.project ?? null;
}
function compactHealth(value?: string): string {
  if (!value) return "unknown";
  return value.replace("conversation-missing", "missing chat").replace("surface-missing", "surface missing").replace("signed-out", "signed out");
}
function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function statusTone(status: CouncilConnectionNode["status"]): string { return `status-${status}`; }

export function CouncilApp() {
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null);
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [councilRuntime, setCouncilRuntime] = useState<CouncilRuntimeViewState | null>(null);
  const [view, setView] = useState<View>("overview");
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectorObservation, setConnectorObservation] = useState<CouncilConnectorObservation>("unknown");
  const executionState = useCouncilExecutionRuns(snapshot?.state.onboardingComplete ? api : undefined);

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    void api.snapshot().then(value => {
      if (disposed) return;
      setSnapshot(value); setBrowser(value.browser); setCouncilRuntime(value.councilRuntime);
    }).catch(error => setError(messageOf(error)));
    const offBrowser = api.onBrowserState(setBrowser);
    const offCouncil = api.onCouncilRuntime(setCouncilRuntime);
    const offState = api.onStateChanged(state => setSnapshot(current => current ? { ...current, state } : current));
    const offUpdate = api.onUpdateState(update => setSnapshot(current => current ? { ...current, update } : current));
    return () => { disposed = true; offBrowser(); offCouncil(); offState(); offUpdate(); };
  }, []);

  useLayoutEffect(() => {
    if (!api) return;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    const visible = view === "chatgpt";
    const measure = () => {
      if (!slot || !visible) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = slot.getBoundingClientRect();
        void api.setBrowserBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch(error => setError(messageOf(error)));
      });
    };
    void api.setBrowserSurfaceActive(visible).then(() => {
      if (!visible) return api.hideBrowser();
      measure();
      observer = slot ? new ResizeObserver(measure) : undefined;
      if (slot) observer?.observe(slot);
      window.addEventListener("resize", measure);
      return api.showBrowser();
    }).catch(error => setError(messageOf(error)));
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [slot, view]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }, [busy]);

  const agents = useMemo(() => managedAgents(councilRuntime), [councilRuntime]);
  const autonomy = useMemo(() => autonomyStatus(councilRuntime), [councilRuntime]);
  const roomId = useMemo(() => projectRoomId(councilRuntime), [councilRuntime]);
  const project = useMemo(() => managedProject(councilRuntime), [councilRuntime]);
  const healthByAgent = useMemo(() => new Map((autonomy?.health ?? []).map(health => [health.agentId, health])), [autonomy]);
  const latestExecutionByAgent = useMemo(() => executionByAgent(executionState.runs), [executionState.runs]);
  const executionAttention = executionState.runs.filter(run => run.status === "uncertain" || run.status === "failed" || run.status === "waiting-user").length;
  const tabByAgent = useMemo(() => new Map((browser?.tabs ?? []).filter(tab => tab.agentId).map(tab => [tab.agentId!, tab])), [browser]);
  const otherTabs = useMemo(() => (browser?.tabs ?? []).filter(tab => tab.id !== "home" && !tab.agentId), [browser]);
  const connections = useMemo(() => councilRuntime ? deriveCouncilConnections({ runtime: councilRuntime, browser, connectorObservation }) : [], [councilRuntime, browser, connectorObservation]);
  const healthyConnections = connections.filter(item => item.status === "healthy").length;
  const nonHealthyConnections = connections.filter(item => item.status !== "healthy");
  const primaryConnectionIssue = nonHealthyConnections[0];

  if (!api) return <div className="council-fatal">Launcher IPC is unavailable.</div>;
  if (!snapshot) return <div className="council-loading"><span className="council-spinner" /><strong>Starting Council runtime…</strong></div>;

  if (!snapshot.state.onboardingComplete) {
    return <main className="council-welcome"><div className="council-welcome-card"><span className="council-mark">C</span><span className="eyebrow">MULTI-AGENT DESKTOP RUNTIME</span><h1>CodexWeb Council</h1><p>Persistent ChatGPT teammates, durable work, evidence-aware recovery and a local operator control plane.</p><button disabled={busy} onClick={() => void run(async () => { const state = await api.completeOnboarding("en"); setSnapshot(current => current ? { ...current, state } : current); })}>{busy ? "Starting…" : "Open Mission Control"}</button><small>v{snapshot.version} · ChatGPT login stays inside the Electron profile.</small></div></main>;
  }

  const authenticated = browser?.authenticated === true;
  const logs = snapshot.logs.slice(-120).reverse();
  const openAgent = (agent: ManagedAgentView) => void run(async () => {
    const tab = tabByAgent.get(agent.id);
    if (tab) await api.selectBrowserTab(tab.id);
    else {
      if (!agent.conversationBound) throw new Error(`${agent.name} has no persistent ChatGPT conversation yet`);
      await api.focusCouncilAgent(agent.id);
    }
    setView("chatgpt");
  });
  const verifyConnections = () => void run(async () => {
    try {
      const report = await api.verifyMcp();
      if (!report.ok) { setConnectorObservation("unknown"); return; }
      setConnectorObservation("verified");
    } catch (error) {
      const text = messageOf(error);
      setConnectorObservation(/connector|CodexWeb Council/i.test(text) ? "missing" : "unknown");
      throw error;
    }
  });
  const bindCurrentLead = () => void run(async () => {
    await api.bindCurrentChatGptAsLead({ projectName: project?.name ?? "ChatGPT Project" });
    setView("agents");
  });

  return <main className="council-shell">
    <header className="council-titlebar">
      <div className="council-titlebar-brand"><span className="council-mark small">C</span><div><strong>CodexWeb Council</strong><small>{project?.name ?? "Mission Control"}</small></div></div>
      <div className="council-titlebar-health"><span className={healthyConnections === connections.length && connections.length ? "system-ready" : "system-degraded"} /><strong>{!connections.length ? "Connecting systems" : nonHealthyConnections.length ? `${nonHealthyConnections.length} connection layer${nonHealthyConnections.length === 1 ? "" : "s"} need attention` : `All ${connections.length} connection layers healthy`}</strong><small>{primaryConnectionIssue ? `${primaryConnectionIssue.label} · ${primaryConnectionIssue.detail}` : autonomy?.dispatcher.activeWorkItemId ? "Autonomy executing" : "Operator ready"}</small></div>
      <div className="council-window-controls no-drag"><button aria-label="Minimize" onClick={() => api.windowControl("minimize")}>—</button><button aria-label="Maximize" onClick={() => api.windowControl("zoom")}>□</button><button className="close" aria-label="Close" onClick={() => api.windowControl("close")}>×</button></div>
    </header>

    <aside className="council-sidebar">
      <div className="council-sidebar-project"><span className="eyebrow">ACTIVE PROJECT</span><strong>{project?.name ?? "No managed project"}</strong><p>{project?.mission ?? "Bind a persistent ChatGPT conversation as Lead to start a managed Council project."}</p></div>
      {(["workspace", "intelligence", "system"] as const).map(group => <div className="council-nav-group" key={group}><span>{group}</span><nav>{NAV.filter(item => item.group === group).map(item => <button key={item.id} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}><i aria-hidden="true" /><div><strong>{item.label}</strong><small>{item.hint}</small></div>{item.id === "work" && (autonomy?.queue.totalActive ?? 0) > 0 ? <em>{autonomy!.queue.totalActive}</em> : null}{item.id === "executions" && executionAttention > 0 ? <em>{executionAttention}</em> : null}</button>)}</nav></div>)}
      <div className="council-sidebar-summary"><div><span>Team</span><strong>{agents.length} agents</strong></div><div><span>Attention</span><strong className={(autonomy?.breakerOpenCount ?? 0) + executionAttention > 0 ? "warn" : ""}>{(autonomy?.breakerOpenCount ?? 0) + (autonomy?.dispatcher.uncertain ?? 0) + executionAttention} items</strong></div></div>
    </aside>

    <section className="council-workspace">
      {view === "overview" ? <Overview project={project} agents={agents} autonomy={autonomy} connections={connections} healthByAgent={healthByAgent} executionByAgent={latestExecutionByAgent} onOpenAgent={openAgent} onNavigate={setView} /> : null}
      {view === "chatgpt" ? <ChatWorkspace browser={browser} agents={agents} autonomy={autonomy} healthByAgent={healthByAgent} tabByAgent={tabByAgent} otherTabs={otherTabs} busy={busy} authenticated={authenticated} projectBound={Boolean(project)} run={run} onBindLead={bindCurrentLead} onOpenAgent={openAgent} setSlot={setSlot} /> : null}
      {view === "agents" ? <AgentsWorkspace agents={agents} healthByAgent={healthByAgent} executionByAgent={latestExecutionByAgent} tabByAgent={tabByAgent} onOpenAgent={openAgent} /> : null}
      {view === "work" ? <WorkWorkspace runtime={councilRuntime} roomId={roomId} autonomy={autonomy} agents={agents} /> : null}
      {view === "executions" ? <ExecutionInspector runs={executionState.runs} loading={executionState.loading} loadError={executionState.error} refreshRuns={executionState.refresh} /> : null}
      {view === "memory" ? <MemoryPanel roomId={roomId} /> : null}
      {view === "connections" ? <ConnectionsWorkspace connections={connections} snapshot={snapshot} busy={busy} onVerify={verifyConnections} onOpenConnectorSetup={() => void run(() => api.openExternal(snapshot.urls.connectors))} /> : null}
      {view === "diagnostics" ? <DiagnosticsWorkspace connections={connections} logs={logs} busy={busy} onVerify={verifyConnections} onDoctor={() => void run(async () => { const report = await api.doctor(); if (!report.ok) throw new Error(report.checks.filter(check => check.status !== "ok").map(check => check.message).join(" · ")); })} /> : null}
      {view === "settings" ? <Settings snapshot={snapshot} busy={busy} run={run} /> : null}
    </section>

    <footer className="council-statusbar">{connections.map(item => <button key={item.id} className={statusTone(item.status)} onClick={() => setView("connections")} title={`${item.evidence} Next: ${item.repair}`}><i /><span>{item.label}</span><strong>{item.detail}</strong></button>)}</footer>
    {error ? <div className="council-error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}>×</button></div> : null}
  </main>;
}

function PageHeader({ eyebrow, title, body, actions }: { eyebrow: string; title: string; body: string; actions?: ReactNode }) {
  return <header className="mission-page-header"><div><span className="page-context">{eyebrow}</span><h2>{title}</h2><p>{body}</p></div>{actions ? <div className="page-actions">{actions}</div> : null}</header>;
}

function Overview({ project, agents, autonomy, connections, healthByAgent, executionByAgent, onOpenAgent, onNavigate }: { project: ReturnType<typeof managedProject>; agents: ManagedAgentView[]; autonomy: CouncilAutonomyStatusView | null; connections: CouncilConnectionNode[]; healthByAgent: Map<string, CouncilAutonomyStatusView["health"][number]>; executionByAgent: Map<string, CouncilExecutionRunView>; onOpenAgent: (agent: ManagedAgentView) => void; onNavigate: (view: View) => void }) {
  const executionAttention = [...executionByAgent.values()].filter(run => run.status === "uncertain" || run.status === "failed" || run.status === "waiting-user").length;
  const attention = connections.filter(item => item.status !== "healthy").length + (autonomy?.breakerOpenCount ?? 0) + (autonomy?.dispatcher.uncertain ?? 0) + executionAttention;
  const active = agents.filter(agent => agent.runtimeStatus === "active" || agent.runtimeStatus === "queued").length;
  return <div className="mission-page"><PageHeader eyebrow="Mission control" title={project?.name ?? "Council overview"} body={project?.mission ?? "Start with a persistent Project conversation, then let Council keep durable team state separate from browser surfaces."} actions={<button className="primary" onClick={() => onNavigate("chatgpt")}>Open ChatGPT workspace</button>} />
    <section className="mission-kpis"><article><span>TEAM</span><strong>{agents.length}</strong><small>{active} active or queued</small></article><article><span>DURABLE WORK</span><strong>{autonomy?.queue.totalActive ?? 0}</strong><small>{autonomy?.dispatcher.activeWorkItemId ? "one browser operation executing" : "scheduler idle"}</small></article><article><span>NEEDS ATTENTION</span><strong className={attention ? "warn" : "good"}>{attention}</strong><small>{autonomy?.dispatcher.uncertain ?? 0} uncertain · {autonomy?.breakerOpenCount ?? 0} breakers · {executionAttention} executions</small></article><article><span>SYSTEMS</span><strong>{connections.filter(item => item.status === "healthy").length}/{connections.length}</strong><small>independently observed layers</small></article></section>
    <div className="overview-grid"><section className="mission-section"><div className="section-heading"><div><span className="eyebrow">TEAM NOW</span><h3>Managed agents</h3></div><button onClick={() => onNavigate("agents")}>View all</button></div><div className="agent-list-compact">{agents.length ? agents.slice(0,6).map(agent => { const health = healthByAgent.get(agent.id); const execution = executionByAgent.get(agent.id); return <button key={agent.id} onClick={() => onOpenAgent(agent)}><i className={`agent-dot runtime-${agent.runtimeStatus}`} /><div><strong>{agent.name}</strong><small>{agent.role}</small></div><em className={`health-${health?.state ?? agent.runtimeStatus}`}>{compactHealth(health?.state ?? agent.runtimeStatus)}</em><ExecutionBadge run={execution} compact /></button>; }) : <EmptyLine text="No managed agents yet" />}</div></section>
      <section className="mission-section"><div className="section-heading"><div><span className="eyebrow">CONNECTION TRUTH</span><h3>System layers</h3></div><button onClick={() => onNavigate("connections")}>Inspect</button></div><ConnectionList connections={connections} compact /></section></div>
  </div>;
}

function ChatWorkspace({ browser, agents, autonomy, healthByAgent, tabByAgent, otherTabs, busy, authenticated, projectBound, run, onBindLead, onOpenAgent, setSlot }: { browser: BrowserState | null; agents: ManagedAgentView[]; autonomy: CouncilAutonomyStatusView | null; healthByAgent: Map<string, CouncilAutonomyStatusView["health"][number]>; tabByAgent: Map<string, BrowserState["tabs"][number]>; otherTabs: BrowserState["tabs"]; busy: boolean; authenticated: boolean; projectBound: boolean; run: (action: () => Promise<unknown>) => Promise<void>; onBindLead: () => void; onOpenAgent: (agent: ManagedAgentView) => void; setSlot: (value: HTMLDivElement | null) => void }) {
  return <div className="chat-workspace"><PageHeader eyebrow="Persistent surfaces" title="ChatGPT workspace" body="Saved agent conversations are durable documents, not disposable tabs. Parked agents reopen through the trusted controller without exposing private conversation URLs." actions={<><button disabled={busy || !authenticated} onClick={onBindLead}>Bind current ChatGPT as Lead</button>{projectBound ? <span className="header-state-good">Managed project bound</span> : null}</>} /><div className="council-browser-toolbar"><div className="council-browser-nav"><button aria-label="Back" disabled={!browser?.canGoBack || busy} onClick={() => void run(() => api!.navigateBrowser("back"))}>←</button><button aria-label="Forward" disabled={!browser?.canGoForward || busy} onClick={() => void run(() => api!.navigateBrowser("forward"))}>→</button><button aria-label="Reload" disabled={busy} onClick={() => void run(() => api!.navigateBrowser("reload"))}>↻</button></div><div className="council-browser-location"><i className={authenticated ? "ok" : "warn"} /><div><strong>{browser?.title || "ChatGPT"}</strong><small>{autonomy?.dispatcher.activeWorkItemId ? `Autonomy · ${autonomy.dispatcher.activeWorkItemId}` : browser?.message || "Browser host starting"}</small></div></div><div className="council-browser-actions">{!authenticated ? <button className="primary" disabled={busy} onClick={() => void run(() => api!.openLogin())}>Sign in</button> : null}<button onClick={() => void run(() => api!.zoomBrowser("out"))}>−</button><button onClick={() => void run(() => api!.zoomBrowser("reset"))}>{Math.round((browser?.zoomFactor ?? 1) * 100)}%</button><button onClick={() => void run(() => api!.zoomBrowser("in"))}>+</button></div></div>
    <div className="council-tabstrip council-project-tabstrip" role="tablist" aria-label="Persistent Council conversations"><button role="tab" aria-selected={browser?.activeTabId === "home"} className={browser?.activeTabId === "home" ? "active" : ""} onClick={() => void run(() => api!.selectBrowserTab("home"))}><i className="tab-home" /><span>Project Lead</span><small>home</small></button>{agents.map(agent => { const tab = tabByAgent.get(agent.id); const health = healthByAgent.get(agent.id); const healthName = health?.state ?? agent.runtimeStatus; return <button role="tab" aria-selected={tab?.active === true} key={agent.id} className={`${tab?.active ? "active " : ""}${tab ? "leased" : "parked"} autonomy-health-${healthName}`} disabled={busy || (!tab && !agent.conversationBound)} title={tab ? `Open ${agent.name}` : agent.conversationBound ? `Reopen saved ${agent.name} conversation` : `${agent.name} has no saved conversation yet`} onClick={() => onOpenAgent(agent)}><i className={`tab-agent runtime-${agent.runtimeStatus}`} /><span>{agent.name}</span><small>{tab ? compactHealth(healthName) : "saved"}</small>{health?.consecutiveFailures ? <b className="agent-failure-count">{health.consecutiveFailures}</b> : null}</button>; })}{otherTabs.map(tab => <button role="tab" aria-selected={tab.active} key={tab.id} className={tab.active ? "active ephemeral" : "ephemeral"} onClick={() => void run(() => api!.selectBrowserTab(tab.id))}><i /><span>{tab.title}</span><small>temporary</small></button>)}</div>
    {autonomy ? <div className="council-autonomy-strip"><span><i className={autonomy.dispatcher.running ? "live" : ""} />Durable loop</span><strong>{autonomy.queue.totalActive} active</strong><small>{autonomy.dispatcher.retryWait} retry wait · {autonomy.dispatcher.uncertain} uncertain · {autonomy.breakerOpenCount} breakers</small></div> : null}
    <div className="council-browser-slot" ref={setSlot}>{!authenticated ? <div className="council-browser-empty"><span>ChatGPT session required</span><strong>Sign in once in the embedded browser.</strong><p>Managed conversations persist locally and can be reopened without exposing their private URL to the renderer.</p></div> : null}</div></div>;
}

function AgentsWorkspace({ agents, healthByAgent, executionByAgent, tabByAgent, onOpenAgent }: { agents: ManagedAgentView[]; healthByAgent: Map<string, CouncilAutonomyStatusView["health"][number]>; executionByAgent: Map<string, CouncilExecutionRunView>; tabByAgent: Map<string, BrowserState["tabs"][number]>; onOpenAgent: (agent: ManagedAgentView) => void }) {
  return <div className="mission-page"><PageHeader eyebrow="Team" title="Managed agents" body="Persistent identity is independent from the physical browser surface. Saved conversations stay actionable even while the agent is parked." />
    <div className="agent-grid">{agents.length ? agents.map(agent => { const health = healthByAgent.get(agent.id); const tab = tabByAgent.get(agent.id); const execution = executionByAgent.get(agent.id); return <article key={agent.id}><div className="agent-card-head"><i className={`agent-avatar runtime-${agent.runtimeStatus}`}>{agent.name.slice(0,1).toUpperCase()}</i><div><h3>{agent.name}</h3><p>{agent.role}</p></div><em className={`health-${health?.state ?? agent.runtimeStatus}`}>{compactHealth(health?.state ?? agent.runtimeStatus)}</em></div><p className="agent-mandate">{agent.mandate}</p><dl><div><dt>Conversation</dt><dd>{agent.conversationBound ? (tab ? "Open surface" : "Saved · parked") : "Not bound"}</dd></div><div><dt>Runtime</dt><dd>{agent.runtimeStatus}</dd></div><div><dt>Execution</dt><dd><ExecutionBadge run={execution} compact /></dd></div><div><dt>Failures</dt><dd>{health?.consecutiveFailures ?? 0}</dd></div><div><dt>Authority</dt><dd>{agent.permissions.length} permissions</dd></div></dl><button className="primary" disabled={!agent.conversationBound && !tab} onClick={() => onOpenAgent(agent)}>{tab ? "Open conversation" : "Reopen saved conversation"}</button></article>; }) : <div className="mission-empty">No managed agents yet.</div>}</div></div>;
}

function WorkWorkspace({ runtime, roomId, autonomy, agents }: { runtime: CouncilRuntimeViewState | null; roomId: string | null; autonomy: CouncilAutonomyStatusView | null; agents: ManagedAgentView[] }) {
  const tasks = runtime?.projection.syncState === "live" || runtime?.projection.syncState === "stale" ? runtime.projection.state.tasks.filter(task => !roomId || task.roomId === roomId) : [];
  return <div className="work-split"><div className="mission-page work-tasks"><PageHeader eyebrow="Work graph" title="Tasks" body="Shared work state stays visible separately from browser execution state." /><ManagerControl agents={agents} /><div className="task-list">{tasks.length ? tasks.slice().sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(task => <article key={task.id}><div><strong>{task.title}</strong><small>{task.assigneeAgentId ? `Assigned to ${task.assigneeAgentId}` : "Unassigned"}</small></div><em className={`task-${task.status}`}>{task.status.replace("_", " ")}</em><p>{task.description}</p></article>) : <div className="mission-empty">No project tasks yet.</div>}</div></div><div className="work-autonomy"><AutonomyPanel roomId={roomId} shared={autonomy} /></div></div>;
}

function ManagerControl({ agents }: { agents: ManagedAgentView[] }) {
  const [status, setStatus] = useState<CouncilSupervisorStatusView | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!api) return;
    setStatus(await api.councilSupervisorStatus());
  }, []);
  useEffect(() => {
    void refresh().catch(error => setError(messageOf(error)));
    const timer = setInterval(() => void refresh().catch(() => {}), 10_000);
    return () => clearInterval(timer);
  }, [refresh]);
  const act = async (action: () => Promise<unknown>) => {
    if (!api || working) return;
    setWorking(true); setError(null);
    try { await action(); await refresh(); } catch (error) { setError(messageOf(error)); } finally { setWorking(false); }
  };
  return <section className="manager-control">
    <div className="manager-control-copy"><span className="manager-control-label">Project manager</span><h3>Autonomous supervisor</h3><p>One selected AI can inspect saved conversations sequentially, review team health and coordinate recovery without overlapping browser work.</p></div>
    <div className="manager-control-actions"><select aria-label="Project Manager" value={status?.managerAgentId ?? ""} disabled={working || agents.length === 0} onChange={event => void act(() => api!.setCouncilSupervisorManager(event.target.value || null))}><option value="">Off</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}</select><button className="primary" disabled={working || !status?.managerAgentId || status.running} onClick={() => void act(() => api!.runCouncilSupervisorNow())}>{status?.running ? "Scanning team…" : "Run supervisor now"}</button></div>
    <div className="manager-control-meta"><span>{status?.managerAgentId ? `Every ${Math.round(status.intervalMs / 60_000)} min` : "Supervisor off"}</span><strong>{status?.scheduler.queued ?? 0} queued</strong>{status?.nextRunAt ? <small>Next {new Date(status.nextRunAt).toLocaleTimeString()}</small> : null}</div>
    {error ? <p className="inline-error">{error}</p> : null}
  </section>;
}

function ConnectionsWorkspace({ connections, snapshot, busy, onVerify, onOpenConnectorSetup }: { connections: CouncilConnectionNode[]; snapshot: LauncherSnapshot; busy: boolean; onVerify: () => void; onOpenConnectorSetup: () => void }) {
  const [tunnelId, setTunnelId] = useState("");
  const [runtimeKey, setRuntimeKey] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const connect = async () => {
    if (!api || setupBusy) return;
    setSetupBusy(true); setSetupMessage(null);
    try {
      const saved = snapshot.mcpCredentialsConfigured;
      const result = saved
        ? await api.setupMcp({ replace: false })
        : await api.setupMcp({ tunnelId: tunnelId.trim(), runtimeKey: runtimeKey.trim(), replace: true });
      if (!result.ok) throw new Error("Council Tunnel setup did not report success");
      setRuntimeKey("");
      setSetupMessage("Tunnel runtime connected. Connector visibility is verified separately in the current ChatGPT session.");
    } catch (error) { setSetupMessage(messageOf(error)); } finally { setSetupBusy(false); }
  };
  const canConnect = snapshot.mcpCredentialsConfigured || (/^tunnel_[a-f0-9]{32}$/i.test(tunnelId.trim()) && runtimeKey.trim().length >= 20);
  return <div className="mission-page"><PageHeader eyebrow="Connection graph" title="Connections" body="Tunnel, MCP, connector, Playwright and ChatGPT are independent layers. One green layer never implies the next one is healthy." actions={<><button disabled={busy} onClick={onVerify}>Verify MCP + connector</button><button className="primary" disabled={busy} onClick={onOpenConnectorSetup}>Open ChatGPT connector setup</button></>} /><ConnectionList connections={connections} />
    <div className="connection-setup-grid">
      <section className="connection-setup-pane"><div className="connection-setup-heading"><div><span className="connection-setup-label">Secure tunnel</span><h3>Connect secure tunnel</h3></div><em className={snapshot.mcpCredentialsConfigured ? "good" : "muted"}>{snapshot.mcpCredentialsConfigured ? "credentials saved" : "not configured"}</em></div><p>The Tunnel starts the local Council MCP runtime. It is not the same thing as ChatGPT seeing the connector.</p>
        {!snapshot.mcpCredentialsConfigured ? <div className="connection-fields"><label><span>Tunnel ID</span><input value={tunnelId} onChange={event => setTunnelId(event.target.value)} placeholder="tunnel_…" autoComplete="off" spellCheck={false} /></label><label><span>Tunnels Read + Use key</span><input type="password" value={runtimeKey} onChange={event => setRuntimeKey(event.target.value)} placeholder="Paste runtime key" autoComplete="off" /></label></div> : null}
        <div className="connection-actions"><button className="primary" disabled={setupBusy || !canConnect} onClick={() => void connect()}>{setupBusy ? "Connecting…" : snapshot.mcpCredentialsConfigured ? "Reconnect saved tunnel" : "Connect secure tunnel"}</button><button disabled={setupBusy} onClick={() => void api!.openExternal(snapshot.urls.tunnels)}>Open Tunnel settings</button></div>{setupMessage ? <p className="connection-setup-message">{setupMessage}</p> : null}
      </section>
      <section className="connection-setup-pane"><div className="connection-setup-heading"><div><span className="connection-setup-label">ChatGPT capability</span><h3>Optional MCP connector</h3></div></div><p>Create the exact <code>CodexWeb Council</code> connector on the same Tunnel when your ChatGPT workspace supports it. Managed browser turns remain usable without this connector.</p><div className="connection-actions"><button onClick={onOpenConnectorSetup}>Open connector settings</button><button disabled={busy} onClick={onVerify}>Verify current session</button></div></section>
    </div>
    <section className="mission-note"><strong>Browser-only Council remains available when the connector is missing.</strong><p>The connector enhances managed turns with MCP tools, but normal AI-to-AI action-footer turns no longer depend on it.</p><small>{snapshot.mcpCredentialsConfigured ? "Tunnel credentials are saved locally." : "Tunnel credentials are not configured."}</small></section>
  </div>;
}

function ConnectionList({ connections, compact = false }: { connections: CouncilConnectionNode[]; compact?: boolean }) {
  return <div className={compact ? "connection-list compact" : "connection-list"}>{connections.map(item => <article key={item.id} className={statusTone(item.status)}><i /><div><strong>{item.label}</strong><p>{item.evidence}</p>{!compact ? <small className="connection-repair"><b>NEXT ACTION</b>{item.repair}</small> : null}</div><em>{item.detail}</em></article>)}</div>;
}

function DiagnosticsWorkspace({ connections, logs, busy, onVerify, onDoctor }: { connections: CouncilConnectionNode[]; logs: LogRecord[]; busy: boolean; onVerify: () => void; onDoctor: () => void }) {
  return <div className="mission-page"><PageHeader eyebrow="Observability" title="Diagnostics" body="Use observed evidence to locate the failing boundary. No single offline badge is allowed to hide which layer actually failed." actions={<><button disabled={busy} onClick={onDoctor}>Run runtime doctor</button><button className="primary" disabled={busy} onClick={onVerify}>Deep connection probe</button></>} /><div className="diagnostic-grid"><section className="mission-section"><div className="section-heading"><div><span className="eyebrow">BOUNDARIES</span><h3>Connection evidence</h3></div></div><ConnectionList connections={connections} compact /></section><section className="mission-section"><div className="section-heading"><div><span className="eyebrow">RECENT EVENTS</span><h3>Launcher timeline</h3></div></div><div className="diagnostic-events">{logs.slice(0,18).map((log,index) => <div key={`${log.at}-${index}`}><time>{new Date(log.at).toLocaleTimeString()}</time><strong>{log.event}</strong><em className={log.level}>{log.level}</em></div>)}</div></section></div><Activity logs={logs} autonomy={null} /></div>;
}

function EmptyLine({ text }: { text: string }) { return <div className="mission-empty compact">{text}</div>; }

function Activity({ logs, autonomy }: { logs: LogRecord[]; autonomy: CouncilAutonomyStatusView | null }) {
  return <div className="council-page"><header><span>RUNTIME</span><h2>Activity</h2><p>Local launcher, durable autonomy and Council events. Secrets are redacted by the logger/audit boundaries.</p></header>
    {autonomy ? <div className="council-autonomy-cards">
      <article><span>DURABLE QUEUE</span><strong>{autonomy.queue.totalActive}</strong><small>{autonomy.dispatcher.activeWorkItemId ? `running ${autonomy.dispatcher.activeWorkItemId}` : "idle"}</small></article>
      <article><span>UNCERTAIN</span><strong className={autonomy.dispatcher.uncertain ? "warn" : ""}>{autonomy.dispatcher.uncertain}</strong><small>never auto-retried</small></article>
      <article><span>BREAKERS</span><strong className={autonomy.breakerOpenCount ? "warn" : ""}>{autonomy.breakerOpenCount}</strong><small>limited / signed-out / quarantined</small></article>
      <article><span>AUDIT</span><strong>{autonomy.audit.count}</strong><small>safe retained transitions</small></article>
    </div> : null}
    {autonomy?.health.length ? <div className="council-health-grid">{autonomy.health.map(item => <article key={item.agentId}><div><strong>{item.agentId}</strong><small>{item.lastFailureCode ?? "no failure"}</small></div><em className={`health-${item.state}`}>{compactHealth(item.state)}</em><span>{item.cooldownUntil ? `cooldown until ${new Date(item.cooldownUntil).toLocaleTimeString()}` : item.lastSuccessAt ? `last success ${new Date(item.lastSuccessAt).toLocaleTimeString()}` : "awaiting evidence"}</span></article>)}</div> : null}
    <div className="council-log-list">{logs.length ? logs.map((log, index) => <article key={`${log.at}-${index}`}><time>{new Date(log.at).toLocaleTimeString()}</time><b className={log.level}>{log.level}</b><strong>{log.event}</strong><code>{JSON.stringify(log.detail)}</code></article>) : <p>No activity yet.</p>}</div>
  </div>;
}

function AutonomyPanel({ roomId, shared }: { roomId: string | null; shared: CouncilAutonomyStatusView | null }) {
  const [status, setStatus] = useState<(CouncilAutonomyStatusView & { exceptionalCount?: number }) | null>(shared);
  const [exceptional, setExceptional] = useState<CouncilExceptionalWorkView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!api36?.councilAutonomyStatus) return;
    const [nextStatus, nextExceptional] = await Promise.all([api36.councilAutonomyStatus(), api36.councilExceptionalWork()]);
    setStatus(nextStatus); setExceptional(nextExceptional); setError(null);
  }, []);
  useEffect(() => { void refresh().catch(error => setError(messageOf(error))); const timer = setInterval(() => void refresh().catch(() => {}), 5_000); return () => clearInterval(timer); }, [refresh]);
  const mutate = async (id: string, action: "cancel" | "retry") => {
    setWorking(id); setError(null);
    try {
      if (action === "cancel") await api36!.cancelCouncilExceptionalWork(id); else await api36!.retryCouncilUncertainWork(id);
      await refresh();
    } catch (error) { setError(messageOf(error)); }
    finally { setWorking(null); }
  };
  return <div className="council-page council-36-page"><header><span>DURABLE EXECUTION</span><h2>Autonomy</h2><p>Exceptional work is deliberately fail-closed. Ambiguous post-submit turns are never retried unless a human explicitly creates a new intent here.</p></header>
    <div className="council-36-kpis">
      <article><span>ACTIVE</span><strong>{status?.queue.totalActive ?? 0}</strong><small>{status?.dispatcher.activeWorkItemId ?? "dispatcher idle"}</small></article>
      <article><span>UNCERTAIN</span><strong className={(status?.dispatcher.uncertain ?? 0) ? "warn" : ""}>{status?.dispatcher.uncertain ?? 0}</strong><small>human resolution required</small></article>
      <article><span>FAILED</span><strong>{status?.dispatcher.failed ?? 0}</strong><small>terminal work records</small></article>
      <article><span>BREAKERS</span><strong className={(status?.breakerOpenCount ?? 0) ? "warn" : ""}>{status?.breakerOpenCount ?? 0}</strong><small>{roomId ? `project ${roomId}` : "no active project"}</small></article>
    </div>
    {error ? <p className="council-36-inline-error">{error}</p> : null}
    <section className="council-36-section"><div className="council-36-section-title"><div><span>OPERATOR QUEUE</span><h3>Exceptional work</h3></div><button onClick={() => void refresh()}>Refresh</button></div>
      {exceptional.length ? <div className="council-36-list">{exceptional.map(item => <article key={item.id} className={`council-36-exception ${item.state}`}><div className="council-36-row"><div><strong>{item.kind}</strong><code>{item.id}</code></div><em>{item.state}</em></div><p>{item.failureCode ?? "terminal"}{item.failureMessage ? ` · ${item.failureMessage}` : ""}</p><small>{item.targetAgentId ? `agent ${item.targetAgentId}` : "no target"}{item.taskId ? ` · task ${item.taskId}` : ""} · phase {item.lastPhase ?? "unknown"} · updated {new Date(item.updatedAt).toLocaleString()}</small><div className="council-36-actions"><button disabled={working === item.id} onClick={() => void mutate(item.id, "cancel")}>Cancel terminal record</button>{item.state === "uncertain" ? <button className="primary" disabled={working === item.id} onClick={() => void mutate(item.id, "retry")}>Create explicit retry intent</button> : null}</div></article>)}</div> : <div className="council-36-empty">No uncertain or failed durable work needs operator attention.</div>}
    </section>
    {status?.health.length ? <section className="council-36-section"><div className="council-36-section-title"><div><span>TEAM SAFETY</span><h3>Health & circuit breakers</h3></div></div><div className="council-36-health">{status.health.map(agent => <article key={agent.agentId}><div><strong>{agent.agentId}</strong><em>{compactHealth(agent.state)}</em></div><small>{agent.lastFailureCode ?? "healthy evidence"}{(agent as typeof agent & { flapping?: boolean }).flapping ? " · flapping detected" : ""}</small></article>)}</div></section> : null}
  </div>;
}

function MemoryPanel({ roomId }: { roomId: string | null }) {
  const [query, setQuery] = useState("");
  const [stats, setStats] = useState<CouncilMemoryStatsView | null>(null);
  const [storage, setStorage] = useState<CouncilEvidenceStatsView>(null);
  const [results, setResults] = useState<CouncilMemoryView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const loadRecent = useCallback(async () => {
    if (!roomId || !api36?.councilMemoryRecent) { setResults([]); return; }
    const [nextStats, nextStorage, recent] = await Promise.all([api36.councilMemoryStats(roomId), api36.councilObservationStorage(), api36.councilMemoryRecent(roomId, 30)]);
    setStats(nextStats); setStorage(nextStorage); setResults(recent); setError(null);
  }, [roomId]);
  useEffect(() => { void loadRecent().catch(error => setError(messageOf(error))); }, [loadRecent]);
  const search = async () => {
    if (!roomId || query.trim().length < 2) return;
    setWorking(true); setError(null);
    try { setResults(await api36!.councilMemorySearch(roomId, query.trim(), 30)); setStats(await api36!.councilMemoryStats(roomId)); }
    catch (error) { setError(messageOf(error)); }
    finally { setWorking(false); }
  };
  const clear = async () => {
    if (!roomId) return;
    setWorking(true); setError(null);
    try { await api36!.clearCouncilProjectMemory(roomId); setResults([]); setStats(await api36!.councilMemoryStats(roomId)); }
    catch (error) { setError(messageOf(error)); }
    finally { setWorking(false); }
  };
  return <div className="council-page council-36-page"><header><span>LONG-HORIZON CONTINUITY</span><h2>Memory</h2><p>Safe bounded project knowledge is retained with provenance. Raw browser pages, credentials, conversation URLs, checkpoints and screenshot bytes are not exposed here.</p></header>
    <div className="council-36-kpis"><article><span>MEMORY ENTRIES</span><strong>{stats?.entries ?? 0}</strong><small>{stats?.newestAt ? `latest ${new Date(stats.newestAt).toLocaleString()}` : "empty index"}</small></article><article><span>EVIDENCE BLOBS</span><strong>{storage?.blobs ?? 0}</strong><small>{storage ? `${storage.references} refs · ${bytes(storage.bytes)}` : "not available"}</small></article><article><span>DEDUP BUDGET</span><strong>{storage ? bytes(storage.maxBytes) : "—"}</strong><small>{storage?.overBudget ? "over budget; prune sources" : "content-addressed archive"}</small></article><article><span>PROJECT</span><strong>{roomId ?? "—"}</strong><small>memory is room-scoped</small></article></div>
    <section className="council-36-section"><div className="council-36-search"><input value={query} placeholder="Search project decisions, tasks, observations, audit evidence…" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void search(); }} disabled={!roomId || working} /><button className="primary" disabled={!roomId || query.trim().length < 2 || working} onClick={() => void search()}>Search</button><button disabled={!roomId || working} onClick={() => void loadRecent()}>Recent</button><button className="danger" disabled={!roomId || working} onClick={() => void clear()}>Clear retained index</button></div>{error ? <p className="council-36-inline-error">{error}</p> : null}
      {results.length ? <div className="council-36-memory-list">{results.map(item => <article key={item.id}><div className="council-36-row"><strong>{item.sourceType}</strong><em>{item.score < 1 ? `${Math.round(item.score * 100)}%` : "recent"}</em></div><p>{item.text}</p><small>source {item.provenance.sourceType}:{item.provenance.sourceId}{item.agentIds.length ? ` · agents ${item.agentIds.join(", ")}` : ""}{item.taskIds.length ? ` · tasks ${item.taskIds.join(", ")}` : ""}</small></article>)}</div> : <div className="council-36-empty">{roomId ? "No retained memory matches this view yet." : "Bind a managed Council project to use project memory."}</div>}
    </section>
  </div>;
}

function Settings({ snapshot, busy, run }: { snapshot: LauncherSnapshot; busy: boolean; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const state = snapshot.state;
  return <div className="council-page"><header><span>DESKTOP</span><h2>Settings</h2><p>Only Council/browser preferences are exposed. There is no Codex route, model catalog, or Codex config control.</p></header><div className="council-settings-grid">
    <Setting title="Start with Windows/macOS" body="Launch Council when you sign in to the computer."><input type="checkbox" checked={state.autoStart} disabled={busy} onChange={event => void run(() => api!.setAutostart(event.target.checked))} /></Setting>
    <Setting title="Keep running on close" body="Close hides the window while active AI conversations can finish."><input type="checkbox" checked={state.keepRunningOnClose} disabled={busy} onChange={event => void run(() => api!.setPreference("keepRunningOnClose", event.target.checked))} /></Setting>
    <Setting title="Show browser during AI turns" body="Reveal persistent ChatGPT surfaces while an agent is working."><input type="checkbox" checked={state.showBrowserDuringTurns} disabled={busy} onChange={event => void run(() => api!.setPreference("showBrowserDuringTurns", event.target.checked))} /></Setting>
    <Setting title="Local logs" body="Open the launcher log directory for diagnostics."><button disabled={busy} onClick={() => void run(() => api!.openLogs())}>Open logs</button></Setting>
    <Setting title="Council Tunnel" body={snapshot.mcpCredentialsConfigured ? "Saved Tunnel credentials are configured." : "Optional until you want the ChatGPT connector/Tunnel path."}><strong>{snapshot.mcpCredentialsConfigured ? "Configured" : "Not configured"}</strong></Setting>
    <Setting title="Updates" body="Stable GitHub releases are verified before install; updates are never silently installed."><strong>{snapshot.update.status}</strong></Setting>
  </div></div>;
}

function Setting({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return <article className="council-setting"><div><strong>{title}</strong><p>{body}</p></div><div>{children}</div></article>;
}
