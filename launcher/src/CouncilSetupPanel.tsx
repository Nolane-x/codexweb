import { useEffect, useState } from "react";

const COUNCIL_CONNECTOR = "CodexWeb Council";

export function CouncilSetupPanel() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [savedCredentials, setSavedCredentials] = useState(false);
  const [tunnelId, setTunnelId] = useState("");
  const [runtimeKey, setRuntimeKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Connect the local Council runtime, then create one ChatGPT connector with the exact name below.");
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
    setMessage(savedCredentials ? "Reconnecting the saved Council tunnel…" : "Installing and connecting the Council tunnel…");
    try {
      const result = savedCredentials
        ? await api.setupMcp({ replace: false })
        : await api.setupMcp({ tunnelId: tunnelId.trim(), runtimeKey: runtimeKey.trim(), replace: true });
      if (!result.ok) throw new Error("Council setup did not report success");
      const snapshot = await api.snapshot();
      setSavedCredentials(snapshot.mcpCredentialsConfigured);
      setRuntimeKey("");
      setMessage(`Runtime connected. In ChatGPT Developer Mode create a new custom MCP connector named exactly “${COUNCIL_CONNECTOR}”, point it at this Tunnel, choose Authentication: None, and allow the Council write actions. Then press Verify.`);
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
        ? `${COUNCIL_CONNECTOR} is connected. Normal ChatGPT conversations can now join rooms, discuss, decide, assign work, and wake one another.`
        : report.checks.filter(check => check.status === "error").map(check => check.message).join(" · ") || "Council verification failed.");
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
            <div><strong>Connect ChatGPT Council</strong><span>No Codex model routing required</span></div>
            <button onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="council-setup-body">
            <div className="council-setup-step"><i>1</i><div><strong>Secure MCP Tunnel</strong><p>The local server stays on your computer. OpenAI’s Secure MCP Tunnel carries the MCP connection without opening a router port.</p></div></div>
            {!savedCredentials && (
              <div className="council-setup-fields">
                <label><span>Tunnel ID</span><input value={tunnelId} onChange={event => setTunnelId(event.target.value)} placeholder="tunnel_…" autoComplete="off" spellCheck={false} /></label>
                <label><span>Tunnels Read + Use key</span><input value={runtimeKey} onChange={event => setRuntimeKey(event.target.value)} type="password" placeholder="Paste runtime key" autoComplete="off" /></label>
              </div>
            )}
            <button className="council-primary-action" disabled={busy || (!savedCredentials && (!/^tunnel_[a-f0-9]{32}$/.test(tunnelId.trim()) || runtimeKey.trim().length < 20))} onClick={() => void connect()}>{busy ? "Working…" : savedCredentials ? "Reconnect saved tunnel" : "Connect Council runtime"}</button>

            <div className="council-setup-step"><i>2</i><div><strong>Create the ChatGPT connector</strong><p>Create a new custom MCP connector named exactly:</p><code>{COUNCIL_CONNECTOR}</code><p>Use the same Tunnel, Authentication: None. Do not rename the old Codex Native connector because ChatGPT can cache connector schemas by identity.</p></div></div>

            <div className="council-setup-step"><i>3</i><div><strong>Verify</strong><p>Verification checks the Council tunnel and the exact connector identity from the launcher-owned ChatGPT browser.</p></div></div>
            <button className={`council-secondary-action${verified ? " verified" : ""}`} disabled={busy || !savedCredentials} onClick={() => void verify()}>{verified ? "✓ Council verified" : "Verify Council connector"}</button>
            <div className={`council-setup-message${verified ? " success" : ""}`}>{message}</div>
          </div>
        </section>
      )}
    </>
  );
}
