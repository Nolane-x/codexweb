import { useEffect, useMemo, useState } from "react";
import type {
  CouncilObservationSummaryView,
  CouncilObservationView,
  CouncilRuntimeViewState,
  CouncilSupervisorStatusView,
  ManagedAgentView,
} from "./types";

function managedAgents(runtime: CouncilRuntimeViewState | null): ManagedAgentView[] {
  if (runtime?.projection.syncState !== "live" && runtime?.projection.syncState !== "stale") return [];
  return runtime.projection.state.managed?.agents ?? [];
}

function formatTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function healthTone(health: string): string {
  if (health === "healthy") return "ok";
  if (health === "sleeping" || health === "busy") return "muted";
  if (health === "limited") return "warn";
  return "bad";
}

export function CouncilSupervisorPanel() {
  const api = window.codexWebLauncher;
  const [open, setOpen] = useState(false);
  const [runtime, setRuntime] = useState<CouncilRuntimeViewState | null>(null);
  const [status, setStatus] = useState<CouncilSupervisorStatusView | null>(null);
  const [history, setHistory] = useState<CouncilObservationSummaryView[]>([]);
  const [selectedRun, setSelectedRun] = useState<CouncilObservationView | null>(null);
  const [screenshots, setScreenshots] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    void api.councilRuntime().then(value => { if (!disposed) setRuntime(value); }).catch(() => {});
    const off = api.onCouncilRuntime(setRuntime);
    return () => { disposed = true; off(); };
  }, []);

  const refresh = async () => {
    if (!api) return;
    const [nextStatus, nextHistory] = await Promise.all([api.councilSupervisorStatus(), api.councilObservations()]);
    setStatus(nextStatus);
    setHistory(nextHistory);
  };

  useEffect(() => {
    if (!open || !api) return;
    let disposed = false;
    const load = () => void refresh().catch(error => { if (!disposed) setError(messageOf(error)); });
    load();
    const timer = window.setInterval(load, 10_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [open]);

  const agents = useMemo(() => managedAgents(runtime), [runtime]);
  const manager = agents.find(agent => agent.id === status?.managerAgentId);

  const act = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await action(); await refresh(); }
    catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  };

  const chooseManager = (agentId: string | null) => act(async () => {
    if (!api) return;
    setStatus(await api.setCouncilSupervisorManager(agentId));
  });

  const openRun = async (runId: string) => {
    if (!api) return;
    setBusy(true);
    setError("");
    try {
      const run = await api.councilObservation(runId);
      setSelectedRun(run);
      setScreenshots({});
    } catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  };

  const loadScreenshot = async (runId: string, screenshotId: string) => {
    if (!api || screenshots[screenshotId]) return;
    try {
      const value = await api.councilObservationScreenshot(runId, screenshotId);
      setScreenshots(current => ({ ...current, [screenshotId]: value }));
    } catch (error) { setError(messageOf(error)); }
  };

  return (
    <>
      <button className={`council-supervisor-launch${status?.enabled ? " is-live" : ""}${open ? " is-open" : ""}`} type="button" onClick={() => setOpen(value => !value)} title="Project Manager supervisor loop">
        <span>⌁</span><strong>Manager</strong>{status?.enabled ? <i /> : null}
      </button>
      {open ? (
        <section className="council-supervisor-panel" role="dialog" aria-label="Council Project Manager supervisor">
          <header>
            <div><span>AUTONOMOUS LOOP</span><strong>Project Manager</strong></div>
            <button type="button" onClick={() => setOpen(false)}>×</button>
          </header>

          <div className="council-supervisor-status">
            <div><span>Manager</span><strong>{manager?.name ?? "Off"}</strong></div>
            <div><span>Cadence</span><strong>{status ? `${Math.round(status.intervalMs / 60_000)} min` : "20 min"}</strong></div>
            <div><span>Next scan</span><strong>{status?.running ? "Scanning now" : formatTime(status?.nextRunAt)}</strong></div>
            <div><span>Queue</span><strong>{status ? `${status.scheduler.queued} waiting` : "—"}</strong></div>
          </div>

          <div className="council-supervisor-copy">
            <p>Select exactly one AI as manager. Electron/Core then checks agents sequentially, scrolls each saved ChatGPT conversation to the bottom, captures it, and gives the evidence to this manager every 20 minutes. Clearing the manager stops future scans.</p>
          </div>

          <div className="council-manager-picker">
            <div className="council-manager-picker-head"><strong>Choose manager</strong><button type="button" disabled={busy || !status?.managerAgentId} onClick={() => void chooseManager(null)}>Turn off</button></div>
            {agents.length ? agents.map(agent => (
              <label key={agent.id} className={status?.managerAgentId === agent.id ? "selected" : ""}>
                <input type="radio" name="council-manager" checked={status?.managerAgentId === agent.id} disabled={busy} onChange={() => void chooseManager(agent.id)} />
                <span><strong>{agent.name}</strong><small>{agent.role}</small></span>
                <em className={`runtime-${agent.runtimeStatus}`}>{agent.runtimeStatus}</em>
              </label>
            )) : <p className="council-supervisor-empty">Bind a managed Council project and create agents first.</p>}
          </div>

          <div className="council-supervisor-actions">
            <button type="button" className="primary" disabled={busy || !status?.managerAgentId || status?.running} onClick={() => void act(async () => { if (api) await api.runCouncilSupervisorNow(); })}>{status?.running ? "Scanning…" : "Run health scan now"}</button>
            {status?.lastError ? <small>{status.lastError}</small> : null}
          </div>

          <div className="council-history-head">
            <div><strong>Retained observations</strong><small>Oldest data is pruned automatically; retained runs can be read by Council AI as bounded memory.</small></div>
            <button type="button" disabled={busy || status?.running || history.length === 0} onClick={() => void act(async () => { if (api) await api.clearCouncilObservations(); setSelectedRun(null); })}>Clear all</button>
          </div>

          <div className="council-history-list">
            {history.map(run => (
              <article key={run.id} className={selectedRun?.id === run.id ? "selected" : ""}>
                <button className="council-history-open" type="button" disabled={busy} onClick={() => void openRun(run.id)}>
                  <span><strong>{formatTime(run.completedAt ?? run.startedAt)}</strong><small>{run.agentCount} agents · {run.screenshotCount} captures</small></span>
                  <em className={`status-${run.status}`}>{run.status}</em>
                </button>
                <button className="council-history-delete" type="button" disabled={busy || status?.running} onClick={() => void act(async () => { if (!api) return; await api.deleteCouncilObservation(run.id); if (selectedRun?.id === run.id) setSelectedRun(null); })}>×</button>
              </article>
            ))}
            {!history.length ? <p className="council-supervisor-empty">No supervisor observations yet.</p> : null}
          </div>

          {selectedRun ? (
            <div className="council-observation-detail">
              <div className="council-observation-detail-head"><strong>{formatTime(selectedRun.completedAt ?? selectedRun.startedAt)}</strong><span>{selectedRun.status}</span></div>
              <div className="council-observation-agents">
                {selectedRun.agents.map(agent => (
                  <article key={agent.agentId}>
                    <div><strong>{agent.name}</strong><small>{agent.role}</small></div>
                    <em className={healthTone(agent.health)}>{agent.health}</em>
                    {agent.note ? <p>{agent.note}</p> : null}
                    {agent.screenshotId ? (
                      screenshots[agent.screenshotId]
                        ? <img src={screenshots[agent.screenshotId]} alt={`${agent.name} ChatGPT observation`} />
                        : <button type="button" disabled={busy} onClick={() => void loadScreenshot(selectedRun.id, agent.screenshotId!)}>Load screenshot</button>
                    ) : null}
                  </article>
                ))}
              </div>
              {selectedRun.managerAnalysis ? <div className="council-manager-analysis"><span>MANAGER ANALYSIS</span><p>{selectedRun.managerAnalysis}</p></div> : null}
              {selectedRun.error ? <div className="council-manager-analysis error"><span>RUN ERROR</span><p>{selectedRun.error}</p></div> : null}
            </div>
          ) : null}

          {error ? <div className="council-supervisor-error">{error}</div> : null}
        </section>
      ) : null}
    </>
  );
}
