import { useEffect, useState } from "react";

const COUNCIL_CONNECTOR = "CodexWeb Council";

export function CouncilSetupPanel() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [savedCredentials, setSavedCredentials] = useState(false);
  const [tunnelId, setTunnelId] = useState("");
  const [runtimeKey, setRuntimeKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Connect the Secure MCP Tunnel to start the local Council service. On Plus, AI-to-AI writes use Electron + Playwright after you bind the Project chat as Lead.");
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const api = window.codexWebLauncher;
    if (!api) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const snapshot = await api.snapshot();
        if (disposed) return;
        setReady(snapshot.state.onboardingComplete);
        setSavedCredentials(snapshot.mcpCredentialsConfigured);
      } catch {}
    };
    void refresh();
    const unsubscribe = api.onStateChanged(() => { void refresh(); });
    return () => { disposed = true; unsubscribe(); };
  }, []);

  async function connect() {
    const api = window.codexWebLauncher;
    if (!api || busy) return;
    setBusy(true);
    setVerified(false);
    setMessage(savedCredentials ? "Reconnecting the saved Council Tunnel…" : "Installing and connecting the Council Tunnel…");
    try {
      const result = savedCredentials
        ? await api.setupMcp({ replace: false })
        : await api.setupMcp({ tunnelId: tunnelId.trim(), runtimeKey: runtimeKey.trim(), replace: true });
      if (!result.ok) throw new Error("Council setup did not report success");
      const snapshot = await api.snapshot();
      setSavedCredentials(snapshot.mcpCredentialsConfigured);
      setRuntimeKey("");
      setMessage(`Council service is online. Plus path: open your persistent Project chat in this Electron browser, then Agents → Bind current ChatGPT as Lead. Optional MCP path: create “${COUNCIL_CONNECTOR}” on the same Tunnel with Authentication: None, then Verify.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const api = window.codexWebLauncher;
    if (!api || busy) return;
    setBusy(true);
    setMessage(`Checking ${COUNCIL_CONNECTOR}…`);
    try {
      const report = await api.verifyMcp();
      setVerified(report.ok);
      setMessage(report.ok
        ? `${COUNCIL_CONNECTOR} is connected. Full MCP-capable workspaces may use Council tools directly; Plus can continue to use the persistent Electron/Playwright Lead path.`
        : report.checks.filter(check => check.status === "error").map(check => check.message).join(" · ") || "Council connector verification failed. The Plus browser path can still be used after the Tunnel service is online.");
    } catch (error) {
      setVerified(false);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;

  return (
    <>
      <button className="council-setup-launch" onClick={() => setOpen(value => !value)} title="Council connection setup" aria-label="Council connection setup">
        <span>⚙</span><span className="council-setup-launch-label">Connect</span>
      </button>
      {open && (
        <section className="council-setup-popover" role="dialog" aria-label="Connect ChatGPT Council">
          <div className="council-setup-head">
            <div><strong>Connect ChatGPT Council</strong><span>Standalone ChatGPT Council · no Codex routing</span></div>
            <button onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="council-setup-body">
            <div className="council-setup-step"><i>1</i><div><strong>Secure MCP Tunnel</strong><p>Starts the local Council service through OpenAI’s Tunnel without exposing a router port. Saved Tunnel credentials from the old app can be reused; no Codex config is read or modified.</p></div></div>
            {!savedCredentials && (
              <div className="council-setup-fields">
                <label><span>Tunnel ID</span><input value={tunnelId} onChange={event => setTunnelId(event.target.value)} placeholder="tunnel_…" autoComplete="off" spellCheck={false} /></label>
                <label><span>Tunnels Read + Use key</span><input value={runtimeKey} onChange={event => setRuntimeKey(event.target.value)} type="password" placeholder="Paste runtime key" autoComplete="off" /></label>
              </div>
            )}
            <button className="council-primary-action" disabled={busy || (!savedCredentials && (!/^tunnel_[a-f0-9]{32}$/.test(tunnelId.trim()) || runtimeKey.trim().length < 20))} onClick={() => void connect()}>{busy ? "Working…" : savedCredentials ? "Reconnect saved tunnel" : "Connect Council runtime"}</button>

            <div className="council-setup-step"><i>2</i><div><strong>Plus: bind your Project chat</strong><p>Open the persistent ChatGPT Project conversation in this Electron browser. Then open <b>Agents</b> and press <b>Bind current ChatGPT as Lead</b>. Lead/child communication is handled by Electron + Playwright, so it does not depend on MCP write actions.</p></div></div>

            <div className="council-setup-step"><i>3</i><div><strong>Optional ChatGPT connector</strong><p>If your workspace exposes custom MCP capabilities, create a new connector named exactly:</p><code>{COUNCIL_CONNECTOR}</code><p>Use the same Tunnel and Authentication: None. Keep it as a separate identity instead of renaming an old connector.</p></div></div>
            <button className={`council-secondary-action${verified ? " verified" : ""}`} disabled={busy || !savedCredentials} onClick={() => void verify()}>{verified ? "✓ Council connector verified" : "Verify Council connector (optional)"}</button>
            <div className={`council-setup-message${verified ? " success" : ""}`}>{message}</div>
          </div>
        </section>
      )}
    </>
  );
}
