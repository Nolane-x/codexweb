import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CouncilExecutionCommandReceiptView,
  CouncilExecutionEventView,
  CouncilExecutionRunView,
  LauncherApi,
} from "./types";
import "./council-execution.css";

const api = window.codexWebLauncher;

export function executionPriority(run: CouncilExecutionRunView): number {
  if (run.status === "uncertain" || run.retrySafety === "operator-resolution-required") return 0;
  if (run.status === "failed") return 1;
  if (run.status === "waiting-user") return 2;
  if (run.status === "active" || run.status === "queued") return 3;
  if (run.status === "aborted") return 4;
  return 5;
}

function orderedRuns(runs: CouncilExecutionRunView[]): CouncilExecutionRunView[] {
  return [...runs].sort((left, right) => executionPriority(left) - executionPriority(right) || right.updatedAt.localeCompare(left.updatedAt));
}

export function executionByAgent(runs: CouncilExecutionRunView[]): Map<string, CouncilExecutionRunView> {
  const map = new Map<string, CouncilExecutionRunView>();
  for (const run of [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) {
    if (!map.has(run.agentId)) map.set(run.agentId, run);
  }
  return map;
}

export function useCouncilExecutionRuns(launcherApi: LauncherApi | undefined, intervalMs = 3_000): {
  runs: CouncilExecutionRunView[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<CouncilExecutionRunView[]>;
} {
  const [runs, setRuns] = useState<CouncilExecutionRunView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!launcherApi) return [];
    setLoading(true);
    try {
      const next = orderedRuns(await launcherApi.councilExecutionRuns());
      setRuns(next);
      setError(null);
      return next;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      setLoading(false);
    }
  }, [launcherApi]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), Math.max(1_500, intervalMs));
    return () => clearInterval(timer);
  }, [intervalMs, refresh]);
  return { runs, loading, error, refresh };
}

function retrySafetyLabel(run: CouncilExecutionRunView): string {
  if (run.retrySafety === "operator-resolution-required") return "Operator resolution required";
  if (run.retrySafety === "forbidden-after-submit") return "Retry forbidden after submit";
  return "Safe before submit";
}

function executionTone(run: CouncilExecutionRunView): string {
  if (run.status === "uncertain" || run.retrySafety === "operator-resolution-required") return "attention";
  if (run.status === "failed") return "danger";
  if (run.status === "waiting-user") return "warn";
  if (run.status === "active" || run.status === "queued") return "live";
  return "muted";
}

export function ExecutionBadge({ run, compact = false }: { run?: CouncilExecutionRunView; compact?: boolean }) {
  if (!run) return <span className="execution-badge muted">no execution</span>;
  return <span className={`execution-badge ${executionTone(run)}${compact ? " compact" : ""}`} title={`${run.kind} · ${run.phase ?? "pre-lease"} · ${retrySafetyLabel(run)}`}>
    <i />{run.status.replace("-", " ")}{!compact && run.deepState ? <small>{run.deepState.replaceAll("_", " ").toLowerCase()}</small> : null}
  </span>;
}

function canRetry(run: CouncilExecutionRunView): boolean {
  return run.retrySafety === "safe-before-submit" && (run.status === "failed" || run.status === "aborted");
}

function canCancel(run: CouncilExecutionRunView): boolean {
  return run.status === "active";
}

function eventSummary(event: CouncilExecutionEventView): string {
  return event.message ?? event.phase ?? event.deepState ?? event.health ?? event.failureCode ?? event.kind;
}

function relevantReceipts(receipts: CouncilExecutionCommandReceiptView[], run: CouncilExecutionRunView): CouncilExecutionCommandReceiptView[] {
  return receipts.filter(receipt => receipt.targetRunId === run.runId || receipt.resultingRunId === run.runId || receipt.targetAgentId === run.agentId).slice(0, 80);
}

export function ExecutionInspector({ runs, loading, loadError, refreshRuns }: {
  runs: CouncilExecutionRunView[];
  loading: boolean;
  loadError: string | null;
  refreshRuns: () => Promise<CouncilExecutionRunView[]>;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<CouncilExecutionEventView[]>([]);
  const [receipts, setReceipts] = useState<CouncilExecutionCommandReceiptView[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ordered = useMemo(() => orderedRuns(runs), [runs]);
  const selected = ordered.find(run => run.runId === selectedRunId) ?? ordered[0] ?? null;

  const loadDetail = useCallback(async (run: CouncilExecutionRunView | null) => {
    if (!api || !run) { setEvents([]); setReceipts([]); return; }
    try {
      const [nextEvents, nextReceipts] = await Promise.all([
        api.councilExecutionEvents(run.runId),
        api.councilExecutionReceipts(),
      ]);
      setEvents(nextEvents);
      setReceipts(relevantReceipts(nextReceipts, run));
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (!selectedRunId && ordered[0]) setSelectedRunId(ordered[0].runId);
  }, [ordered, selectedRunId]);
  useEffect(() => { void loadDetail(selected); }, [loadDetail, selected?.runId, selected?.updatedAt]);

  const mutate = async (name: string, action: () => Promise<{ run: CouncilExecutionRunView } | { resultingRun: CouncilExecutionRunView }>) => {
    if (!api || working) return;
    setWorking(name); setError(null);
    try {
      const result = await action();
      const target = "resultingRun" in result ? result.resultingRun : result.run;
      setSelectedRunId(target.runId);
      await refreshRuns();
      await loadDetail(target);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      await refreshRuns();
    } finally {
      setWorking(null);
    }
  };

  const uncertainCount = ordered.filter(run => run.status === "uncertain").length;
  const activeCount = ordered.filter(run => run.status === "active" || run.status === "queued").length;
  const failedCount = ordered.filter(run => run.status === "failed").length;
  const abnormalCount = ordered.filter(run => executionPriority(run) < 3).length;

  return <div className="execution-inspector">
    <header className="execution-inspector-header">
      <div><span>MANAGED BROWSER EXECUTION</span><h2>Execution Inspector</h2><p>Observable browser phases, Deep State, retry safety and command receipts. Telemetry describes runtime state only.</p></div>
      <button disabled={loading} onClick={() => void refreshRuns()}>{loading ? "Refreshing…" : "Refresh"}</button>
    </header>

    <div className="execution-summary-line">
      <span><b>{activeCount}</b> live</span><span className={uncertainCount ? "execution-attention" : ""}><b>{uncertainCount}</b> uncertain</span><span><b>{failedCount}</b> failed</span><span><b>{abnormalCount}</b> need attention</span>
      {loadError ? <em>{loadError}</em> : null}
    </div>

    <div className="execution-layout">
      <aside className="execution-run-list" aria-label="Execution runs">
        {ordered.length ? ordered.map(run => <button key={run.runId} className={`${selected?.runId === run.runId ? "selected " : ""}${executionTone(run)}`} onClick={() => setSelectedRunId(run.runId)}>
          <i /><div><strong>{run.agentId}</strong><small>{run.kind} · {run.phase ?? "pre-lease"}</small></div><ExecutionBadge run={run} compact /><time>{new Date(run.updatedAt).toLocaleTimeString()}</time>
        </button>) : <div className="execution-empty">No managed browser executions have been observed yet.</div>}
      </aside>

      <section className="execution-detail">
        {selected ? <>
          <div className={`execution-attention ${executionTone(selected)}`}>
            <div><span>RUN</span><strong>{selected.agentId} · {selected.kind}</strong><small>{selected.runId}</small></div>
            <ExecutionBadge run={selected} />
          </div>
          <dl className="execution-facts">
            <div><dt>Phase</dt><dd>{selected.phase ?? "Not leased"}</dd></div>
            <div><dt>Deep State</dt><dd>{selected.deepState?.replaceAll("_", " ") ?? "No observation"}</dd></div>
            <div><dt>Retry safety</dt><dd className={`retry-${selected.retrySafety}`}>{retrySafetyLabel(selected)}</dd></div>
            <div><dt>Failure family</dt><dd>{selected.failureCode ?? "None"}</dd></div>
            <div><dt>Conversation</dt><dd>{selected.conversationBound ? "Bound by controller" : "Not bound"}</dd></div>
            <div><dt>Surface</dt><dd>{selected.surfaceBound ? "Surface acquired" : "No surface"}</dd></div>
          </dl>
          {selected.failureMessage ? <p className="execution-failure"><strong>{selected.failureCode ?? "Failure"}</strong>{selected.failureMessage}</p> : null}
          {selected.retrySafety === "operator-resolution-required" ? <p className="execution-resolution">Operator resolution required. Remote delivery may have happened; ordinary retry remains disabled.</p> : null}
          {selected.retrySafety === "forbidden-after-submit" ? <p className="execution-resolution muted">Retry forbidden after submit. This run cannot cross the external submission boundary automatically.</p> : null}

          <div className="execution-actions">
            {canCancel(selected) ? <button disabled={Boolean(working)} onClick={() => void mutate("cancel", () => api!.cancelCouncilExecution(selected.runId))}>{working === "cancel" ? "Cancelling…" : "Cancel local execution"}</button> : null}
            {canRetry(selected) ? <button className="primary" disabled={Boolean(working)} onClick={() => void mutate("retry", () => api!.retryCouncilExecution(selected.runId))}>{working === "retry" ? "Retrying…" : "Retry safe pre-submit run"}</button> : null}
            {selected.conversationBound ? <button disabled={Boolean(working)} onClick={() => void mutate("focus", () => api!.focusCouncilExecutionAgent(selected.agentId))}>Focus agent</button> : null}
            {selected.conversationBound ? <button disabled={Boolean(working)} onClick={() => void mutate("capture", () => api!.captureCouncilExecutionAgent(selected.agentId))}>Capture observation</button> : null}
          </div>
          {error ? <p className="execution-inline-error">{error}</p> : null}

          <div className="execution-evidence-grid">
            <section><div className="execution-section-heading"><span>BOUNDED EVENTS</span><h3>Execution timeline</h3></div><div className="execution-timeline">{events.length ? events.map(event => <article key={event.eventId}><time>{new Date(event.at).toLocaleTimeString()}</time><i /><div><strong>{event.kind}</strong><p>{eventSummary(event)}</p>{event.confidence !== undefined ? <small>{Math.round(event.confidence * 100)}% confidence</small> : null}</div></article>) : <div className="execution-empty">No retained events for this run.</div>}</div></section>
            <section><div className="execution-section-heading"><span>OPERATOR AUDIT</span><h3>Command receipts</h3></div><div className="execution-receipts">{receipts.length ? receipts.map(receipt => <article key={receipt.receiptId} className={receipt.outcome}><div><strong>{receipt.commandType}</strong><em>{receipt.outcome}</em></div><p>{receipt.reason}</p><small>{receipt.actorId} · {new Date(receipt.requestedAt).toLocaleString()}</small></article>) : <div className="execution-empty">No command receipts touch this run or agent.</div>}</div></section>
          </div>
        </> : <div className="execution-empty detail">Select a run when execution telemetry becomes available.</div>}
      </section>
    </div>
  </div>;
}
