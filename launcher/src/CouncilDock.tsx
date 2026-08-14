import { useEffect, useMemo, useRef, useState } from "react";
import { effectivePresenceFreshness, presenceLabel } from "./council-presence";
import type { CouncilRuntimeViewState, CouncilSharedStateView, CouncilTaskView, CouncilWakeStatusView } from "./types";

function timeLabel(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "AI";
}

function shortStatus(value: CouncilTaskView["status"]): string {
  return value.replaceAll("_", " ");
}

function wakeStatusLabel(value: CouncilWakeStatusView): string {
  const canonical = value === "pending" ? "queued" : value === "delivering" ? "target-running" : value === "acknowledged" ? "replied" : value;
  return canonical.replaceAll("-", " ");
}

function CouncilLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="9" r="3" />
      <circle cx="16" cy="9" r="3" />
      <path d="M4.5 18c.7-2.7 2.2-4 4.5-4s3.8 1.3 4.5 4M12 18c.6-2.1 1.8-3.2 3.8-3.2 1.9 0 3.1 1.1 3.7 3.2" />
    </svg>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="council-empty"><div className="council-empty-mark"><CouncilLogo /></div><strong>{title}</strong><p>{detail}</p></div>;
}

function sharedSnapshot(runtime: CouncilRuntimeViewState | null): CouncilSharedStateView | null {
  if (runtime?.projection.syncState === "live" || runtime?.projection.syncState === "stale") return runtime.projection.state;
  return null;
}

export function CouncilDock() {
  const [visible, setVisible] = useState(false);
  const [launcherReady, setLauncherReady] = useState(false);
  const [runtime, setRuntime] = useState<CouncilRuntimeViewState | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messageFilter, setMessageFilter] = useState<"all" | "proposal">("all");
  const [followLatest, setFollowLatest] = useState(true);
  const [presenceClockMs, setPresenceClockMs] = useState(() => Date.now());
  const restoreBrowser = useRef(false);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const api = window.codexWebLauncher;
    if (!api) return;
    let disposed = false;
    void api.snapshot().then(value => {
      if (disposed) return;
      setLauncherReady(value.state.onboardingComplete);
      setRuntime(value.councilRuntime);
    }).catch(() => {});
    const offState = api.onStateChanged(state => setLauncherReady(state.onboardingComplete));
    const offCouncil = api.onCouncilRuntime(setRuntime);
    return () => { disposed = true; offState(); offCouncil(); };
  }, []);

  const syncState = runtime?.projection.syncState ?? "idle";
  const live = syncState === "live";
  const stale = syncState === "stale";
  const syncError = syncState === "error";
  const snapshot = sharedSnapshot(runtime);
  const lastSyncedAt = runtime?.projection.syncState === "live" || runtime?.projection.syncState === "stale"
    ? runtime.projection.lastSyncedAt
    : undefined;
  const managedProject = runtime?.managedProject;
  const capabilities = runtime?.capabilities;
  const localExecutionAvailable = Boolean(capabilities?.secureTunnel.available || capabilities?.localRepo.available || capabilities?.fullMcp.available);
  const roomCount = snapshot ? String(snapshot.rooms.length) : "—";
  const participantCount = snapshot ? String(snapshot.agents.length) : "—";

  useEffect(() => {
    const rooms = snapshot?.rooms ?? [];
    if (rooms.length === 0) { setSelectedRoomId(null); return; }
    if (!selectedRoomId || !rooms.some(room => room.id === selectedRoomId)) setSelectedRoomId(rooms[0]!.id);
  }, [snapshot, selectedRoomId]);

  useEffect(() => {
    if (!visible) return;
    setPresenceClockMs(Date.now());
    const timer = window.setInterval(() => setPresenceClockMs(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") void closeCouncil(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  const selectedRoom = snapshot?.rooms.find(room => room.id === selectedRoomId) ?? null;
  const agentsById = useMemo(() => new Map((snapshot?.agents ?? []).map(agent => [agent.id, agent])), [snapshot]);
  const presenceByAgent = useMemo(() => new Map((snapshot?.presence ?? []).map(presence => [presence.agentId, presence])), [snapshot]);
  const messages = useMemo(() => (snapshot?.messages ?? [])
    .filter(message => message.roomId === selectedRoomId)
    .filter(message => messageFilter === "all" || message.kind === "proposal"), [snapshot, selectedRoomId, messageFilter]);
  const activeTasks = useMemo(() => (snapshot?.tasks ?? []).filter(task => task.roomId === selectedRoomId && task.status !== "done").slice(-12).reverse(), [snapshot, selectedRoomId]);
  const wakeActivity = useMemo(() => (snapshot?.wakes ?? []).filter(wake => wake.roomId === selectedRoomId).slice(-10).reverse(), [snapshot, selectedRoomId]);
  const decisions = useMemo(() => (snapshot?.decisions ?? []).filter(decision => decision.roomId === selectedRoomId).slice(-8).reverse(), [snapshot, selectedRoomId]);

  useEffect(() => {
    if (!visible || !followLatest || !feedRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [visible, selectedRoomId, messages.length, followLatest]);

  async function openCouncil() {
    const api = window.codexWebLauncher;
    if (api) {
      try {
        const state = await api.snapshot();
        setRuntime(state.councilRuntime);
        restoreBrowser.current = state.browser?.surfaceActive === true;
        if (restoreBrowser.current) await api.setBrowserSurfaceActive(false);
      } catch { restoreBrowser.current = false; }
    }
    setVisible(true);
    setFollowLatest(true);
  }

  async function closeCouncil() {
    setVisible(false);
    const api = window.codexWebLauncher;
    if (restoreBrowser.current && api) {
      restoreBrowser.current = false;
      await api.setBrowserSurfaceActive(true).catch(() => {});
    }
  }

  if (!launcherReady) return null;

  const sharedStatus = live ? "Shared Council live" : stale ? "Shared Council reconnecting" : syncError ? "Shared Council sync error" : "Syncing shared Council";
  const projectStatus = managedProject?.state === "attached" ? "Project attached" : managedProject?.state === "forbidden" ? "Project access forbidden" : managedProject?.state === "error" ? "Project state error" : "No managed project attached";
  const executionStatus = localExecutionAvailable ? "Local tools available" : "Local tools unavailable";

  return (
    <>
      <button className={`council-dock-button${visible ? " is-open" : ""}`} onClick={() => visible ? void closeCouncil() : void openCouncil()} aria-label={visible ? "Close Council" : "Open Council"} title="ChatGPT Council">
        <span className="council-dock-icon"><CouncilLogo /></span>
        <span className="council-dock-label">Council</span>
        <span className={`council-connection-dot ${live ? "online" : "offline"}`} aria-hidden="true" />
      </button>

      {visible && (
        <section className="council-overlay" role="dialog" aria-label="ChatGPT Council">
          <header className="council-topbar">
            <div className="council-product-title"><span className="council-product-mark"><CouncilLogo /></span><div><strong>ChatGPT Council</strong><span>Canonical shared collaboration</span></div></div>
            <div className="council-topbar-actions">
              <span className={`council-runtime-pill ${live ? "online" : "offline"}`}><i />{sharedStatus}</span>
              <span className="council-runtime-pill"><i />{projectStatus}</span>
              <span className="council-runtime-pill"><i />{executionStatus}</span>
              <button className="council-close" onClick={() => void closeCouncil()} aria-label="Close Council">×</button>
            </div>
          </header>

          <div className="council-layout">
            <aside className="council-rooms-pane">
              <div className="council-pane-heading"><span>Rooms</span><small>{roomCount}</small></div>
              <div className="council-room-list">
                {(snapshot?.rooms ?? []).map(room => (
                  <button key={room.id} className={`council-room-button${room.id === selectedRoomId ? " active" : ""}`} onClick={() => { setSelectedRoomId(room.id); setFollowLatest(true); }}>
                    <span className="council-hash">#</span><span><strong>{room.name}</strong><small>{room.mission}</small></span>
                  </button>
                ))}
              </div>
              <div className="council-local-note"><span className={`council-connection-dot ${live ? "online" : "offline"}`} /> <span>{lastSyncedAt ? `Last sync ${timeLabel(lastSyncedAt)}` : "Waiting for first canonical snapshot"}</span></div>
            </aside>

            <main className="council-chat-pane">
              <div className="council-room-header">
                <div><div className="council-room-title"><span>#</span>{selectedRoom?.name ?? "Council"}</div><p>{selectedRoom?.mission ?? "Shared deliberation between named ChatGPT participants."}</p></div>
                <div className="council-filter"><button className={messageFilter === "all" ? "active" : ""} onClick={() => setMessageFilter("all")}>All</button><button className={messageFilter === "proposal" ? "active" : ""} onClick={() => setMessageFilter("proposal")}>Proposals</button></div>
              </div>

              <div ref={feedRef} className="council-message-feed" onScroll={event => { const el = event.currentTarget; setFollowLatest(el.scrollHeight - el.scrollTop - el.clientHeight < 80); }}>
                {syncError && !snapshot && <EmptyState title="Shared Council state is unavailable" detail="The canonical session is not synchronized yet. Rooms and participants are unknown rather than empty." />}
                {!syncError && !snapshot && <EmptyState title="Synchronizing shared Council" detail="Waiting for the first authoritative snapshot. Local execution tools are not required to read shared Council state." />}
                {stale && snapshot && <div className="council-stale-notice">Reconnecting · showing the last synchronized Council snapshot from {timeLabel(lastSyncedAt)}.</div>}
                {live && !selectedRoom && <EmptyState title="No Council room yet" detail="The latest authoritative canonical snapshot currently contains no rooms." />}
                {stale && !selectedRoom && <EmptyState title="No room in the last synchronized snapshot" detail="Council is reconnecting; this is stale data, not an authoritative current empty state." />}
                {snapshot && selectedRoom && messages.length === 0 && <EmptyState title="The room is quiet" detail="Connected ChatGPT participants will appear here as soon as they use Council discussion tools." />}
                {snapshot && messages.map(message => {
                  const author = agentsById.get(message.authorAgentId);
                  return (
                    <article key={message.id} className={`council-message${message.replyTo ? " reply" : ""}`}>
                      <div className="council-avatar">{initials(author?.name ?? message.authorAgentId)}</div>
                      <div className="council-message-content">
                        <div className="council-message-meta"><strong>{author?.name ?? message.authorAgentId}</strong><span>{author?.role ?? "Council participant"}</span><time>{timeLabel(message.createdAt)}</time>{message.kind !== "message" && <em className={`council-kind ${message.kind}`}>{message.kind}</em>}</div>
                        <div className="council-message-body">{message.body}</div>
                        {message.mentions.length > 0 && <div className="council-mentions">{message.mentions.map(id => <span key={id}>@{agentsById.get(id)?.name ?? id}</span>)}</div>}
                      </div>
                    </article>
                  );
                })}
              </div>
              {!followLatest && messages.length > 0 && <button className="council-jump-latest" onClick={() => setFollowLatest(true)}>↓ Jump to latest</button>}
            </main>

            <aside className="council-intel-pane">
              <div className="council-intel-scroll">
                <section className="council-intel-section">
                  <div className="council-pane-heading"><span>Participants</span><small>{participantCount}</small></div>
                  <div className="council-agent-list">
                    {(snapshot?.agents ?? []).map(agent => {
                      const presence = presenceByAgent.get(agent.id);
                      const presenceFreshness = effectivePresenceFreshness(presence, presenceClockMs);
                      const leaseExpiresAt = presence && presence.freshness !== "unknown" ? presence.leaseExpiresAt : undefined;
                      return (
                        <div className="council-agent" key={agent.id}>
                          <div className="council-mini-avatar">{initials(agent.name)}<i className={`presence-${presenceFreshness}`} title={`Presence: ${presenceLabel(presenceFreshness)}`} /></div>
                          <div><strong>{agent.name}</strong><span>{agent.role}</span></div>
                          <small>status {agent.status} · presence {presenceLabel(presenceFreshness)}{leaseExpiresAt ? ` · lease ${timeLabel(leaseExpiresAt)}` : ""}</small>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section className="council-intel-section">
                  <div className="council-pane-heading"><span>Wake activity</span><small>{wakeActivity.length}</small></div>
                  {wakeActivity.length === 0 ? <p className="council-muted">No wakes in this snapshot.</p> : wakeActivity.map(wake => (
                    <div className={`council-intel-card wake ${wake.status}`} key={wake.id}>
                      <div><strong>Wake {agentsById.get(wake.targetAgentId)?.name ?? wake.targetAgentId}</strong><span className="council-status-tag">{wakeStatusLabel(wake.status)}</span></div>
                      <p>{wake.reason}</p>
                      {(wake.transitions?.length ?? 0) > 0 && (
                        <div className="council-wake-timeline" aria-label="Wake transition timeline">
                          {wake.transitions!.map((transition, index) => (
                            <span className={`council-wake-step ${transition.status}`} key={`${transition.at}-${index}`}>
                              <i aria-hidden="true" />
                              <b>{wakeStatusLabel(transition.status)}</b>
                              <time>{timeLabel(transition.at)}</time>
                            </span>
                          ))}
                        </div>
                      )}
                      {wake.expiresAt && <small>expires {timeLabel(wake.expiresAt)}</small>}
                      {wake.lastError && <small>{wake.lastError}</small>}
                    </div>
                  ))}
                </section>
                <section className="council-intel-section"><div className="council-pane-heading"><span>Active work</span><small>{activeTasks.length}</small></div>{activeTasks.length === 0 ? <p className="council-muted">No active tasks.</p> : activeTasks.map(task => <div className={`council-intel-card task ${task.status}`} key={task.id}><div><strong>{task.title}</strong><span className="council-status-tag">{shortStatus(task.status)}</span></div><p>{task.description}</p>{task.assigneeAgentId && <small>→ {agentsById.get(task.assigneeAgentId)?.name ?? task.assigneeAgentId}</small>}</div>)}</section>
                <section className="council-intel-section"><div className="council-pane-heading"><span>Decisions</span><small>{decisions.length}</small></div>{decisions.length === 0 ? <p className="council-muted">No final policy yet.</p> : decisions.map(decision => <div className="council-intel-card decision" key={decision.id}><strong>{decision.title}</strong><p>{decision.policy}</p>{decision.unresolvedRisks.length > 0 && <small>{decision.unresolvedRisks.length} unresolved risk{decision.unresolvedRisks.length === 1 ? "" : "s"}</small>}</div>)}</section>
              </div>
            </aside>
          </div>
        </section>
      )}
    </>
  );
}