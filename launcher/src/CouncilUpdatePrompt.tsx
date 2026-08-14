import { useEffect, useState } from "react";
import type { UpdateState } from "./types";

const SKIP_KEY = "codexweb-council.skipped-update";

export function CouncilUpdatePrompt() {
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.codexWebLauncher;
    if (!api) return;
    let disposed = false;
    void api.snapshot().then(snapshot => { if (!disposed) setUpdate(snapshot.update); }).catch(() => {});
    const unsubscribe = api.onUpdateState(setUpdate);
    return () => { disposed = true; unsubscribe(); };
  }, []);

  const version = "version" in update ? update.version : null;
  const skipped = version ? localStorage.getItem(SKIP_KEY) === version : false;
  const visible = Boolean(version && !skipped && dismissedVersion !== version && ["available", "downloading", "installing"].includes(update.status));
  if (!visible || !version) return null;

  const install = async () => {
    const api = window.codexWebLauncher;
    if (!api || busy || update.status !== "available") return;
    setBusy(true);
    setError(null);
    try { await api.installUpdate(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };

  const later = () => { if (update.status === "available") setDismissedVersion(version); };
  const skip = () => {
    if (update.status !== "available") return;
    localStorage.setItem(SKIP_KEY, version);
    setDismissedVersion(version);
  };

  return (
    <div className="council-update-backdrop" role="presentation">
      <section className="council-update-card" role="dialog" aria-modal="true" aria-label={`CodexWeb Council update ${version}`}>
        <div className="council-update-mark">↻</div>
        <div className="council-update-copy">
          <span className="council-update-kicker">CodexWeb Council update</span>
          <h2>Version {version} is ready</h2>
          <p>{update.status === "available" ? "A verified GitHub Release is available. You choose when to install it." : update.status === "downloading" ? "Downloading and verifying the release with SHA-256…" : "The verified update worker is preparing installation…"}</p>
          {error ? <div className="council-update-error">{error}</div> : null}
        </div>
        <div className="council-update-actions">
          {update.status === "available" ? (
            <>
              <button className="council-update-secondary" disabled={busy} onClick={skip} type="button">Skip this version</button>
              <button className="council-update-secondary" disabled={busy} onClick={later} type="button">Later</button>
              <button className="council-update-primary" disabled={busy} onClick={() => void install()} type="button">{busy ? "Preparing…" : "Update now"}</button>
            </>
          ) : <span className="council-update-progress">Please keep CodexWeb Council open while the update is prepared.</span>}
        </div>
      </section>
    </div>
  );
}
