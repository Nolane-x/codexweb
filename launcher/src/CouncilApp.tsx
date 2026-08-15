import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { BrowserState, CouncilRuntimeViewState, LauncherSnapshot, LogRecord, ManagedAgentView } from "./types";
import "./council-shell.css";

const api = window.codexWebLauncher;
type View = "chatgpt" | "activity" | "settings";

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function managedAgents(runtime: CouncilRuntimeViewState | null): ManagedAgentView[] {
  if (runtime?.projection.syncState !== "live" && runtime?.projection.syncState !== "stale") return [];
  return runtime.projection.state.managed?.agents ?? [];
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
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><b>⚙</b><span>Settings</span></button>
        </nav>
        <div className="council-sidebar-health">
          <div><span>Browser</span><strong>{authenticated ? "Ready" : browser?.status ?? "Starting"}</strong></div>
          <div><span>Tunnel</span><strong>{snapshot.mcpCredentialsConfigured ? "Configured" : "Optional"}</strong></div>
          <div><span>Agents</span><strong>{agents.length || browser?.tabs.filter(tab => tab.agentId).length || 0} project</strong></div>
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
              <div className="council-browser-location"><i className={authenticated ? "ok" : "warn"} /><span>{browser?.title || "ChatGPT"}</span><small>{browser?.message || "Starting browser"}</small></div>
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
                return (
                  <button key={agent.id} className={`${tab?.active ? "active" : ""}${tab ? "" : " parked"}`} disabled={!tab || busy} title={tab ? `Open ${agent.name}` : `${agent.name} is ${agent.runtimeStatus}; its persistent conversation is saved and will reopen when called`} onClick={() => tab ? void run(() => api.selectBrowserTab(tab.id)) : undefined}>
                    <i className={`tab-agent runtime-${agent.runtimeStatus}`} /><span>{agent.name}</span><small>{agent.runtimeStatus}</small>
                  </button>
                );
              })}
              {otherTabs.map(tab => <button key={tab.id} className={tab.active ? "active" : ""} onClick={() => void run(() => api.selectBrowserTab(tab.id))}><i /><span>{tab.title}</span></button>)}
            </div>
            <div className="council-browser-slot" ref={setSlot}>
              {!authenticated ? <div className="council-browser-empty"><span>◎</span><strong>Sign in once, then open the persistent Project conversation you want as Lead.</strong><p>After the Tunnel is connected, open Agents and choose “Bind current ChatGPT as Lead”.</p></div> : null}
            </div>
          </>
        ) : null}

        {view === "activity" ? <Activity logs={logs} /> : null}
        {view === "settings" ? <Settings snapshot={snapshot} busy={busy} run={run} /> : null}
      </section>

      {error ? <div className="council-error"><span>{error}</span><button onClick={() => setError(null)}>×</button></div> : null}
    </main>
  );
}

function Activity({ logs }: { logs: LogRecord[] }) {
  return <div className="council-page"><header><span>RUNTIME</span><h2>Activity</h2><p>Local launcher and Council events. Secrets are redacted by the logger boundary.</p></header><div className="council-log-list">{logs.length ? logs.map((log, index) => <article key={`${log.at}-${index}`}><time>{new Date(log.at).toLocaleTimeString()}</time><b className={log.level}>{log.level}</b><strong>{log.event}</strong><code>{JSON.stringify(log.detail)}</code></article>) : <p>No activity yet.</p>}</div></div>;
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
