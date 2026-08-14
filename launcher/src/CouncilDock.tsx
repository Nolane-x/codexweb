import { useEffect, useMemo, useRef, useState } from "react";

const COUNCIL_ENDPOINT = "http://127.0.0.1:17842/api/state";

type AgentStatus = "awake" | "sleeping" | "offline";
type WakeStatus = "pending" | "delivering" | "acknowledged" | "failed";
type TaskStatus = "todo" | "claimed" | "in_progress" | "review" | "done" | "blocked";
type MessageKind = "message" | "proposal" | "decision" | "system";

interface CouncilAgentView { id: string; name: string; role: string; status: AgentStatus; updatedAt: string }
interface CouncilRoomView { id: string; name: string; mission: string; updatedAt: string }
interface CouncilMessageView { id: string; roomId: string; authorAgentId: string; kind: MessageKind; body: string; threadId: string; replyTo?: string; mentions: string[]; createdAt: string }
interface CouncilDecisionView { id: string; roomId: string; createdByAgentId: string; title: string; policy: string; rationale: string; unresolvedRisks: string[]; createdAt: string }
interface CouncilTaskView { id: string; roomId: string; assigneeAgentId?: string; title: string; description: string; status: TaskStatus; updatedAt: string }
interface CouncilWakeView { id: string; targetAgentId: string; sourceAgentId?: string; roomId: string; reason: string; status: WakeStatus; attempts: number; lastError?: string; updatedAt: string }
interface CouncilSnapshotView { version: 1; generatedAt: string; agents: CouncilAgentView[]; rooms: CouncilRoomView[]; messages: CouncilMessageView[]; decisions: CouncilDecisionView[]; tasks: CouncilTaskView[]; wakes: CouncilWakeView[] }

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "AI";
}

function shortStatus(value: TaskStatus): string {
  return value.replaceAll("_", " ");
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

export function CouncilDock() {
  const [visible, setVisible] = useState(false);
  const [launcherReady, setLauncherReady] = useState(false);
  const [snapshot, setSnapshot] = useState<CouncilSnapshotView | null>(null);
  const [online, setOnline] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messageFilter, setMessageFilter] = useState<"all" | "proposal">("all");
  const [followLatest, setFollowLatest] = useState(true);
  const restoreBrowser = useRef(false);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const api = window.codexWebLauncher;
    if (!api) return;
    let disposed = false;
    void api.snapshot().then(value => { if (!disposed) setLauncherReady(value.state.onboardingComplete); }).catch(() => {});
    const unsubscribe = api.onStateChanged(state => setLauncherReady(state.onboardingComplete));
    return () => { disposed = true; unsubscribe(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let activeController: AbortController | null = null;
    const poll = async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 1_800);
      try {
        const response = await fetch(COUNCIL_ENDPOINT, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Council HTTP ${response.status}`);
        const value = await response.json() as CouncilSnapshotView;
        if (disposed || value.version !== 1 || !Array.isArray(value.rooms)) return;
        setSnapshot(value);
        setOnline(true);
      } catch {
        if (!disposed) setOnline(false);
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void poll();
    const interval = window.setInterval(() => { void poll(); }, 1_500);
    return () => { disposed = true; activeController?.abort(); window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    const rooms = snapshot?.rooms ?? [];
    if (rooms.length === 0) { setSelectedRoomId(null); return; }
    if (!selectedRoomId || !rooms.some(room => room.id === selectedRoomId)) setSelectedRoomId(rooms[0]!.id);
  }, [snapshot, selectedRoomId]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") void closeCouncil(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  const selectedRoom = snapshot?.rooms.find(room => room.id === selectedRoomId) ?? null;
  const agentsById = useMemo(() => new Map((snapshot?.agents ?? []).map(agent => [agent.id, agent])), [snapshot]);
  const messages = useMemo(() => (snapshot?.messages ?? [])
    .filter(message => message.roomId === selectedRoomId)
    .filter(message => messageFilter === "all" || message.kind === "proposal"), [snapshot, selectedRoomId, messageFilter]);
  const activeTasks = useMemo(() => (snapshot?.tasks ?? []).filter(task => task.roomId === selectedRoomId && task.status !== "done").slice(-12).reverse(), [snapshot, selectedRoomId]);
  const activeWakes = useMemo(() => (snapshot?.wakes ?? []).filter(wake => wake.roomId === selectedRoomId && (wake.status === "pending" || wake.status === "delivering" || wake.status === "failed")).slice(-10).reverse(), [snapshot, selectedRoomId]);
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

  return (
    <>
      <button className={`council-dock-button${visible ? " is-open" : ""}`} onClick={() => visible ? void closeCouncil() : void openCouncil()} aria-label={visible ? "Close Council" : "Open Council"} title="ChatGPT Council">
        <span className="council-dock-icon"><CouncilLogo /></span>
        <span className="council-dock-label">Council</span>
        <span className={`council-connection-dot ${online ? "online" : "offline"}`} aria-hidden="true" />
      </button>

      {visible && (
        <section className="council-overlay" role="dialog" aria-label="ChatGPT Council">
          <header className="council-topbar">
            <div className="council-product-title"><span className="council-product-mark"><CouncilLogo /></span><div><strong>ChatGPT Council</strong><span>Local intelligence room</span></div></div>
            <div className="council-topbar-actions"><span className={`council-runtime-pill ${online ? "online" : "offline"}`}><i />{online ? "Council online" : "Council offline"}</span><button className="council-close" onClick={() => void closeCouncil()} aria-label="Close Council">×</button></div>
          </header>

          <div className="council-layout">
            <aside className="council-rooms-pane">
              <div className="council-pane-heading"><span>Rooms</span><small>{snapshot?.rooms.length ?? 0}</small></div>
              <div className="council-room-list">
                {(snapshot?.rooms ?? []).map(room => (
                  <button key={room.id} className={`council-room-button${room.id === selectedRoomId ? " active" : ""}`} onClick={() => { setSelectedRoomId(room.id); setFollowLatest(true); }}>
                    <span className="council-hash">#</span><span><strong>{room.name}</strong><small>{room.mission}</small></span>
                  </button>
                ))}
              </div>
              <div className="council-local-note"><span className={`council-connection-dot ${online ? "online" : "offline"}`} /> <span>127.0.0.1 · private room</span></div>
            </aside>

            <main className="council-chat-pane">
              <div className="council-room-header">
                <div><div className="council-room-title"><span>#</span>{selectedRoom?.name ?? "Council"}</div><p>{selectedRoom?.mission ?? "Shared deliberation between named ChatGPT participants."}</p></div>
                <div className="council-filter"><button className={messageFilter === "all" ? "active" : ""} onClick={() => setMessageFilter("all")}>All</button><button className={messageFilter === "proposal" ? "active" : ""} onClick={() => setMessageFilter("proposal")}>Proposals</button></div>
              </div>

              <div ref={feedRef} className="council-message-feed" onScroll={event => { const el = event.currentTarget; setFollowLatest(el.scrollHeight - el.scrollTop - el.clientHeight < 80); }}>
                {!online && <EmptyState title="Council runtime is offline" detail="Start the Full MCP / Secure Tunnel runtime. The launcher UI stays available while the Council service is down." />}
                {online && !selectedRoom && <EmptyState title="No Council room yet" detail="Ask a connected ChatGPT to create the first room with council_room_upsert." />}
                {online && selectedRoom && messages.length === 0 && <EmptyState title="The room is quiet" detail="Connected ChatGPT participants will appear here as soon as they use council_say, council_reply, or council_propose." />}
                {online && messages.map(message => {
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
                <section className="council-intel-section"><div className="council-pane-heading"><span>Participants</span><small>{snapshot?.agents.length ?? 0}</small></div><div className="council-agent-list">{(snapshot?.agents ?? []).map(agent => <div className="council-agent" key={agent.id}><div className="council-mini-avatar">{initials(agent.name)}<i className={agent.status} /></div><div><strong>{agent.name}</strong><span>{agent.role}</span></div><small>{agent.status}</small></div>)}</div></section>
                <section className="council-intel-section"><div className="council-pane-heading"><span>Wake queue</span><small>{activeWakes.length}</small></div>{activeWakes.length === 0 ? <p className="council-muted">No pending wakes.</p> : activeWakes.map(wake => <div className={`council-intel-card wake ${wake.status}`} key={wake.id}><div><strong>Wake {agentsById.get(wake.targetAgentId)?.name ?? wake.targetAgentId}</strong><span className="council-status-tag">{wake.status}</span></div><p>{wake.reason}</p>{wake.lastError && <small>{wake.lastError}</small>}</div>)}</section>
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
