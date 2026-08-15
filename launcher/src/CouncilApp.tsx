import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { BrowserState, CouncilAutonomyStatusView, CouncilRuntimeViewState, LauncherSnapshot, LogRecord, ManagedAgentView } from "./types";
import "./council-shell.css";
import "./council-36.css";

type CouncilExceptionalWorkView = {
  id: string;
  kind: string;
  projectRoomId: string;
  targetAgentId?: string;
  taskId?: string;
  state: "uncertain" | "failed";
  attempt: number;
  maxAttempts: number;
  lastPhase?: string;
  failureCode?: string;
  failureMessage?: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  reasons: string[];
};
type CouncilMemoryView = {
  id: string;
  projectRoomId: string;
  sourceType: string;
  sourceId: string;
  text: string;
  agentIds: string[];
  taskIds: string[];
  updatedAt: string;
  score: number;
  provenance: { sourceType: string; sourceId: string };
};
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
type View = "chatgpt" | "activity" | "autonomy" | "memory" | "settings";

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

function compactHealth(value?: string): string {
  if (!value) return "unknown";
  return value.replace("conversation-missing", "missing chat").replace("surface-missing", "surface").replace("signed-out", "signed out");
}
function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function CouncilApp() {
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null);
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [councilRuntime, setCouncilRuntime] = useState<CouncilRuntimeViewState | null>(null);
  const [view, setView] = useState<View>("chatgpt");
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    void api.snapshot().then(value => {
      if (disposed) return;
      setSnapshot(value);
      setBrowser(value.browser);
      setCouncilRuntime(value.councilRuntime);
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
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  }, [busy]);

  const agents = useMemo(() => managedAgents(councilRuntime), [councilRuntime]);
  const autonomy = useMemo(() => autonomyStatus(councilRuntime), [councilRuntime]);
  const roomId = useMemo(() => projectRoomId(councilRuntime), [councilRuntime]);
  const healthByAgent = useMemo(() => new Map((autonomy?.health ?? []).map(health => [health.agentId, health])), [autonomy]);
  const tabByAgent = useMemo(() => new Map((browser?.tabs ?? []).filter(tab => tab.agentId).map(tab => [tab.agentId!, tab])), [browser]);
  const otherTabs = useMemo(() => (browser?.tabs ?? []).filter(tab => tab.id !== "home" && !tab.agentId), [browser]);

  if (!api) return <div className="council-fatal">Launcher IPC is unavailable.</div>;
  if (!snapshot) return <div className="council-loading"><span>◌</span><strong>Starting CodexWeb Council…</strong></div>;

  if (!snapshot.state.onboardingComplete) {
    return (
      <main className="council-welcome">
        <div className="council-welcome-card">
          <span className="council-mark">C</span>
          <h1>CodexWeb Council</h1>
          <p>Persistent ChatGPT teammates that can discuss, critique, wake one another, reach policy, and coordinate work through Electron.</p>
          <button disabled={busy} onClick={() => void run(async () => {
            const state = await api.completeOnboarding("en");
            setSnapshot(current => current ? { ...current, state } : current);
          })}>{busy ? "Starting…" : "Enter Council"}</button>
          <small>v{snapshot.version} · ChatGPT account login stays inside the Electron browser profile.</small>
        </div>
      </main>
    );
  }

  const authenticated = browser?.authenticated === true;
  const logs = snapshot.logs.slice(-120).reverse();

  return (
    <main className="council-shell">
      <header className="council-titlebar">
        <div className="council-titlebar-brand"><span className="council-mark small">C</span><strong>CodexWeb Council</strong><em>v{snapshot.version}</em></div>
        <div className="council-titlebar-status"><i className={authenticated ? "ok" : "warn"} />{authenticated ? "ChatGPT signed in" : "Sign in required"}</div>
        <div className="council-window-controls no-drag">
          <button aria-label="Minimize" onClick={() => api.windowControl("minimize")}>—</button>
          <button aria-label="Maximize" onClick={() => api.windowControl("zoom")}>□</button>
          <button aria-label="Close" onClick={() => api.windowControl("close")}>×</button>
        </div>
      </header>

      <aside className="council-sidebar">
        <div className="council-sidebar-copy"><span>COUNCIL</span><strong>ChatGPT workspace</strong><p>Electron owns identity and persistent conversations. Tunnel is optional transport, never Codex routing.</p></div>
        <nav>
          <button className={view === "chatgpt" ? "active" : ""} onClick={() => setView("chatgpt")}><b>◎</b><span>ChatGPT</span></button>
          <button className={view === "activity" ? "active" : ""} onClick={() => setView("activity")}><b>≋</b><span>Activity</span></button>
          <button className={view === "autonomy" ? "active" : ""} onClick={() => setView("autonomy")}><b>↻</b><span>Autonomy</span></button>
          <button className={view === "memory" ? "active" : ""} onClick={() => setView("memory")}><b>◇</b><span>Memory</span></button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><b>⚙</b><span>Settings</span></button>
        </nav>
        <div className="council-sidebar-health">
          <div><span>Browser</span><strong>{authenticated ? "Ready" : browser?.status ?? "Starting"}</strong></div>
          <div><span>Tunnel</span><strong>{snapshot.mcpCredentialsConfigured ? "Configured" : "Optional"}</strong></div>
          <div><span>Agents</span><strong>{agents.length || browser?.tabs.filter(tab => tab.agentId).length || 0} project</strong></div>
          <div><span>Autonomy</span><strong className={autonomy?.dispatcher.running ? "autonomy-ok" : ""}>{autonomy ? `${autonomy.queue.totalActive} queued` : "Starting"}</strong></div>
          <div><span>Breakers</span><strong className={autonomy?.breakerOpenCount ? "autonomy-warn" : ""}>{autonomy?.breakerOpenCount ?? 0} open</strong></div>
        </div>
      </aside>

      <section className="council-workspace">
        {view === "chatgpt" ? (
          <>
            <div className="council-browser-toolbar">
              <div className="council-browser-nav">
                <button disabled={!browser?.canGoBack || busy} onClick={() => void run(() => api.navigateBrowser("back"))}>←</button>
                <button disabled={!browser?.canGoForward || busy} onClick={() => void run(() => api.navigateBrowser("forward"))}>→</button>
                <button disabled={busy} onClick={() => void run(() => api.navigateBrowser("reload"))}>↻</button>
              </div>
              <div className="council-browser-location"><i className={authenticated ? "ok" : "warn"} /><span>{browser?.title || "ChatGPT"}</span><small>{autonomy?.dispatcher.activeWorkItemId ? `Autonomy running ${autonomy.dispatcher.activeWorkItemId}` : browser?.message || "Starting browser"}</small></div>
              <div className="council-browser-actions">
                {!authenticated ? <button className="primary" disabled={busy} onClick={() => void run(() => api.openLogin())}>Sign in to ChatGPT</button> : null}
                <button onClick={() => void run(() => api.zoomBrowser("out"))}>−</button>
                <button onClick={() => void run(() => api.zoomBrowser("reset"))}>{Math.round((browser?.zoomFactor ?? 1) * 100)}%</button>
                <button onClick={() => void run(() => api.zoomBrowser("in"))}>+</button>
              </div>
            </div>
            <div className="council-tabstrip council-project-tabstrip" aria-label="Project ChatGPT agents">
              <button className={browser?.activeTabId === "home" ? "active" : ""} onClick={() => void run(() => api.selectBrowserTab("home"))}><i className="tab-home" /><span>Project chat</span></button>
              {agents.map(agent => {
                const tab = tabByAgent.get(agent.id);
                const health = healthByAgent.get(agent.id);
                const healthName = health?.state ?? agent.runtimeStatus;
                return (
                  <button key={agent.id} className={`${tab?.active ? "active" : ""}${tab ? "" : " parked"} autonomy-health-${healthName}`} disabled={!tab || busy} title={tab ? `Open ${agent.name} · ${healthName}` : `${agent.name} is ${agent.runtimeStatus}; durable health=${healthName}; its persistent conversation is saved and will reopen when called`} onClick={() => tab ? void run(() => api.selectBrowserTab(tab.id)) : undefined}>
                    <i className={`tab-agent runtime-${agent.runtimeStatus}`} /><span>{agent.name}</span><small>{compactHealth(healthName)}</small>{health?.consecutiveFailures ? <b className="agent-failure-count">{health.consecutiveFailures}</b> : null}
                  </button>
                );
              })}
              {otherTabs.map(tab => <button key={tab.id} className={tab.active ? "active" : ""} onClick={() => void run(() => api.selectBrowserTab(tab.id))}><i /><span>{tab.title}</span></button>)}
            </div>
            {autonomy ? <div className="council-autonomy-strip"><span><i className={autonomy.dispatcher.running ? "live" : ""} /> durable loop</span><strong>{autonomy.queue.totalActive} active</strong><small>{autonomy.dispatcher.retryWait} retry wait · {autonomy.dispatcher.uncertain} uncertain · {autonomy.breakerOpenCount} breakers · {autonomy.audit.count} audit events</small></div> : null}
            <div className="council-browser-slot" ref={setSlot}>
              {!authenticated ? <div className="council-browser-empty"><span>◎</span><strong>Sign in once, then open the persistent Project conversation you want as Lead.</strong><p>After the Tunnel is connected, bind the current persistent ChatGPT as Lead.</p></div> : null}
            </div>
          </>
        ) : null}

        {view === "activity" ? <Activity logs={logs} autonomy={autonomy} /> : null}
        {view === "autonomy" ? <AutonomyPanel roomId={roomId} shared={autonomy} /> : null}
        {view === "memory" ? <MemoryPanel roomId={roomId} /> : null}
        {view === "settings" ? <Settings snapshot={snapshot} busy={busy} run={run} /> : null}
      </section>

      {error ? <div className="council-error"><span>{error}</span><button onClick={() => setError(null)}>×</button></div> : null}
    </main>
  );
}

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

function Setting({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return <article className="council-setting"><div><strong>{title}</strong><p>{body}</p></div><div>{children}</div></article>;
}
