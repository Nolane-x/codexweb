const { randomUUID } = require("node:crypto");
const { onCouncilRuntimeLiveChanged } = require("./council-runtime-evidence.cjs");

const DEFAULT_PORT = 17_842;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_WAIT_MS = 15_000;
const DEFAULT_RETRY_MS = 1_500;

const CAPABILITY_NAMES = ["secureTunnel", "localRepo", "githubConnector", "fullMcp", "wakeEngine"];
const SAFE_ERROR_KINDS = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError"]);

function safeReason(code, retryable = true) {
  return { code, retryable };
}

function safeErrorKind(error) {
  const name = error instanceof Error && typeof error.name === "string" ? error.name : "Error";
  return SAFE_ERROR_KINDS.has(name) ? name : "Error";
}

function safeCorrelationId(value) {
  if (typeof value === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(value)) return value;
  return `council-${randomUUID()}`;
}

function unavailableCapabilities() {
  return Object.fromEntries(CAPABILITY_NAMES.map(name => [name, {
    available: false,
    state: "error",
    reason: safeReason("CAPABILITY_UNAVAILABLE", true),
  }]));
}

function normalizeCapabilities(provider) {
  let supplied = {};
  try { supplied = typeof provider === "function" ? provider() || {} : {}; }
  catch { supplied = {}; }
  const fallback = unavailableCapabilities();
  for (const name of CAPABILITY_NAMES) {
    const value = supplied[name];
    if (value && typeof value === "object" && typeof value.available === "boolean") fallback[name] = structuredClone(value);
  }
  return fallback;
}

function configuredBaseUrl() {
  const raw = process.env.CODEXWEB_COUNCIL_UI_PORT?.trim();
  const port = raw ? Number(raw) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("CODEXWEB_COUNCIL_UI_PORT must be an integer from 1 to 65535");
  return `http://127.0.0.1:${port}`;
}

function normalizePresence(state) {
  if (state.presence === undefined) return { ...state, presence: [] };
  if (!Array.isArray(state.presence)) throw new Error("Council sync snapshot presence is invalid");
  const seen = new Set();
  for (const entry of state.presence) {
    if (!entry || typeof entry !== "object" || typeof entry.agentId !== "string" || !entry.agentId) {
      throw new Error("Council sync snapshot presence entry is invalid");
    }
    if (seen.has(entry.agentId)) throw new Error("Council sync snapshot presence contains duplicate agent ids");
    seen.add(entry.agentId);
    if (entry.freshness === "unknown") continue;
    if (entry.freshness !== "fresh" && entry.freshness !== "stale") throw new Error("Council sync snapshot presence freshness is invalid");
    if (typeof entry.lastSeenAt !== "string" || !Number.isFinite(Date.parse(entry.lastSeenAt))) {
      throw new Error("Council sync snapshot presence lastSeenAt is invalid");
    }
    if (typeof entry.leaseExpiresAt !== "string" || !Number.isFinite(Date.parse(entry.leaseExpiresAt))) {
      throw new Error("Council sync snapshot presence leaseExpiresAt is invalid");
    }
  }
  return state;
}

function validateSnapshotEnvelope(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || typeof value.cursor !== "string" || !value.cursor || typeof value.generatedAt !== "string") {
    throw new Error("Council sync snapshot envelope is invalid");
  }
  const state = value.state;
  if (!state || typeof state !== "object" || state.version !== 1 || !Array.isArray(state.agents) || !Array.isArray(state.rooms) || !Array.isArray(state.messages) || !Array.isArray(state.decisions) || !Array.isArray(state.tasks) || !Array.isArray(state.wakes)) {
    throw new Error("Council sync snapshot state is invalid");
  }
  const normalizedState = normalizePresence(state);
  if (normalizedState === state) return value;
  return { ...value, state: normalizedState };
}

async function fetchWithDeadline(fetchImpl, url, options = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) relayAbort();
  else options.signal?.addEventListener("abort", relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Council sync request timed out")), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal, redirect: "error" });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relayAbort);
  }
}

function createCouncilSyncClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Council sync fetch is unavailable");
  const baseUrl = options.baseUrl || configuredBaseUrl();
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error("Council sync endpoint must be a plain loopback origin");
  }
  const origin = parsed.origin;
  const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs) ? Math.max(250, Math.trunc(options.requestTimeoutMs)) : DEFAULT_REQUEST_TIMEOUT_MS;
  const waitMs = Number.isFinite(options.waitMs) ? Math.max(0, Math.min(25_000, Math.trunc(options.waitMs))) : DEFAULT_WAIT_MS;

  return {
    async getSnapshot(signal) {
      const response = await fetchWithDeadline(fetchImpl, `${origin}/api/sync/snapshot`, { method: "GET", signal }, requestTimeoutMs);
      if (!response.ok) throw new Error(`Council sync snapshot HTTP ${response.status}`);
      return validateSnapshotEnvelope(await response.json());
    },
    async next({ after, signal }) {
      if (typeof after !== "string" || !after) throw new Error("Council sync continuation cursor is required");
      const url = new URL(`${origin}/api/sync/next`);
      url.searchParams.set("after", after);
      url.searchParams.set("wait_ms", String(waitMs));
      const response = await fetchWithDeadline(fetchImpl, url.toString(), { method: "GET", signal }, Math.max(requestTimeoutMs, waitMs + 5_000));
      if (response.status === 204) return { type: "idle" };
      const value = await response.json().catch(() => ({}));
      if (response.status === 409 && value?.type === "resync-required" && value?.reason?.code === "RESYNC_REQUIRED") return { type: "resync-required" };
      if (!response.ok) throw new Error(`Council sync continuation HTTP ${response.status}`);
      return { type: "snapshot", envelope: validateSnapshotEnvelope(value) };
    },
  };
}

function managedProjectFromState(sharedState) {
  const project = sharedState?.managed?.project;
  if (!project || typeof project !== "object") return { state: "unattached", reason: safeReason("PROJECT_UNATTACHED", false) };
  return {
    state: "attached",
    projectId: typeof project.id === "string" ? project.id : typeof project.roomId === "string" ? project.roomId : "managed-project",
  };
}

class CouncilConnectionSupervisor {
  constructor(options = {}) {
    this.client = options.client || createCouncilSyncClient(options.clientOptions);
    this.capabilitiesProvider = options.capabilities;
    this.subscribeCapabilityChanges = typeof options.subscribeCapabilityChanges === "function"
      ? options.subscribeCapabilityChanges
      : onCouncilRuntimeLiveChanged;
    this.capabilityUnsubscribe = null;
    this.publish = typeof options.publish === "function" ? options.publish : () => {};
    this.logger = options.logger;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.correlationId = safeCorrelationId(options.correlationId);
    this.staleSinceMs = null;
    this.retryMs = Number.isFinite(options.retryMs) ? Math.max(100, Math.trunc(options.retryMs)) : DEFAULT_RETRY_MS;
    this.running = false;
    this.abortController = null;
    this.runtime = {
      controlPlane: { state: "connecting" },
      projection: { syncState: "idle" },
      managedProject: { state: "unattached", reason: safeReason("PROJECT_UNATTACHED", false) },
      capabilities: normalizeCapabilities(this.capabilitiesProvider),
    };
    this.ensureCapabilitySubscription();
  }

  snapshot() { return structuredClone(this.runtime); }
  emit() { this.publish(this.snapshot()); }

  diagnostic(level, event, fields = {}) {
    try {
      const writer = this.logger?.[level];
      if (typeof writer === "function") writer.call(this.logger, event, { correlationId: this.correlationId, ...fields });
    } catch {
      // Diagnostics are non-authoritative hints and cannot perturb Council synchronization.
    }
  }

  ensureCapabilitySubscription() {
    if (this.capabilityUnsubscribe || typeof this.subscribeCapabilityChanges !== "function") return;
    const unsubscribe = this.subscribeCapabilityChanges(() => { this.refreshCapabilities(); });
    if (typeof unsubscribe === "function") this.capabilityUnsubscribe = unsubscribe;
  }

  refreshCapabilities() {
    this.runtime = {
      ...this.runtime,
      capabilities: normalizeCapabilities(this.capabilitiesProvider),
    };
    this.emit();
    return this.snapshot();
  }

  applyEnvelope(envelope) {
    const value = validateSnapshotEnvelope(envelope);
    const observedAt = this.now();
    const staleSinceMs = this.staleSinceMs;
    this.runtime = {
      controlPlane: { state: "connected" },
      projection: {
        syncState: "live",
        state: structuredClone(value.state),
        cursor: value.cursor,
        lastSyncedAt: value.generatedAt,
      },
      managedProject: managedProjectFromState(value.state),
      capabilities: normalizeCapabilities(this.capabilitiesProvider),
    };
    this.staleSinceMs = null;
    this.emit();
    if (staleSinceMs !== null) {
      this.diagnostic("info", "council.shared_projection_recovered", {
        staleDurationMs: Math.max(0, observedAt - staleSinceMs),
      });
    }
    return this.snapshot();
  }

  markFailure(code) {
    const reason = safeReason(code, true);
    const previous = this.runtime.projection;
    if ((previous.syncState === "live" || previous.syncState === "stale") && previous.state) {
      const firstStaleTransition = previous.syncState === "live" || this.staleSinceMs === null;
      if (this.staleSinceMs === null) this.staleSinceMs = this.now();
      this.runtime = {
        ...this.runtime,
        controlPlane: { state: "degraded", reason },
        projection: {
          syncState: "stale",
          state: previous.state,
          cursor: previous.cursor,
          lastSyncedAt: previous.lastSyncedAt,
          reason,
        },
        capabilities: normalizeCapabilities(this.capabilitiesProvider),
      };
      this.emit();
      if (firstStaleTransition) this.diagnostic("warn", "council.shared_projection_stale", { reasonCode: code });
    } else {
      this.runtime = {
        ...this.runtime,
        controlPlane: { state: "offline", reason },
        projection: { syncState: "error", reason },
        capabilities: normalizeCapabilities(this.capabilitiesProvider),
      };
      this.emit();
    }
    return this.snapshot();
  }

  async hydrateOnce(signal) {
    const startedAt = this.now();
    const hasGoodProjection = this.runtime.projection.syncState === "live" || this.runtime.projection.syncState === "stale";
    if (!hasGoodProjection) {
      this.runtime = { ...this.runtime, controlPlane: { state: "connecting" }, projection: { syncState: "hydrating" } };
      this.emit();
    }
    try {
      const runtime = this.applyEnvelope(await this.client.getSnapshot(signal));
      this.diagnostic("info", "council.shared_hydrated", { latencyMs: Math.max(0, this.now() - startedAt) });
      return runtime;
    } catch (error) {
      this.diagnostic("warn", "council.shared_snapshot_failed", {
        reason: safeErrorKind(error),
        latencyMs: Math.max(0, this.now() - startedAt),
      });
      return this.markFailure("SNAPSHOT_FAILED");
    }
  }

  async sleep(ms, signal) {
    if (signal?.aborted) return;
    await new Promise(resolve => {
      const timer = setTimeout(done, ms);
      function done() { signal?.removeEventListener("abort", done); clearTimeout(timer); resolve(); }
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  async run(signal) {
    await this.hydrateOnce(signal);
    while (!signal.aborted) {
      const projection = this.runtime.projection;
      const cursor = projection.syncState === "live" || projection.syncState === "stale" ? projection.cursor : undefined;
      if (!cursor || typeof this.client.next !== "function") {
        await this.sleep(this.retryMs, signal);
        if (!signal.aborted) await this.hydrateOnce(signal);
        continue;
      }
      try {
        const frame = await this.client.next({ after: cursor, signal });
        if (signal.aborted) break;
        if (frame?.type === "idle") continue;
        if (frame?.type === "resync-required") {
          this.diagnostic("info", "council.shared_resync_required", { reasonCode: "RESYNC_REQUIRED" });
          this.runtime = { ...this.runtime, controlPlane: { state: "degraded", reason: safeReason("RESYNC_REQUIRED", true) } };
          this.emit();
          await this.hydrateOnce(signal);
          continue;
        }
        if (frame?.type === "snapshot") {
          this.applyEnvelope(frame.envelope);
          continue;
        }
        throw new Error("Council sync continuation frame is invalid");
      } catch (error) {
        if (signal.aborted) break;
        this.diagnostic("warn", "council.shared_stream_interrupted", { reason: safeErrorKind(error) });
        this.markFailure("STREAM_INTERRUPTED");
        await this.sleep(this.retryMs, signal);
      }
    }
  }

  start() {
    if (this.running) return;
    this.ensureCapabilitySubscription();
    this.running = true;
    this.abortController = new AbortController();
    void this.run(this.abortController.signal).finally(() => { this.running = false; this.abortController = null; });
  }

  async stop() {
    this.abortController?.abort();
    this.running = false;
    this.capabilityUnsubscribe?.();
    this.capabilityUnsubscribe = null;
  }
}

module.exports = {
  CAPABILITY_NAMES,
  CouncilConnectionSupervisor,
  createCouncilSyncClient,
  unavailableCapabilities,
  validateSnapshotEnvelope,
};
