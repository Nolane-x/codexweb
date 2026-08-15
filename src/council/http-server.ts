import { randomUUID } from "node:crypto";
import { ownerBearerMatches } from "./owner-control";
import type { PublicManagedAgent } from "./managed-runtime";
import type { ManagedCouncilProject } from "./managed-project-state";
import { CouncilStore } from "./store";
import type { CouncilAgent, CouncilAgentPresence, CouncilDecision, CouncilMessage, CouncilRoom, CouncilState, CouncilTask, CouncilWakeEvent } from "./types";
import { normalizeCouncilWakeStatus } from "./work-operations";

export const COUNCIL_HTTP_HOST = "127.0.0.1";
export const COUNCIL_HTTP_DEFAULT_PORT = 17_842;
const OWNER_BODY_LIMIT = 64 * 1024;
const MAX_SYNC_CURSOR_BYTES = 1_024;
const DEFAULT_SYNC_WAIT_MS = 15_000;
const MAX_SYNC_WAIT_MS = 25_000;

export interface CouncilManagedPublicView {
  project: ManagedCouncilProject | null;
  agents: PublicManagedAgent[];
}

export interface CouncilPublicSnapshot {
  version: 1;
  generatedAt: string;
  agents: CouncilAgent[];
  presence: CouncilAgentPresence[];
  rooms: CouncilRoom[];
  messages: CouncilMessage[];
  decisions: CouncilDecision[];
  tasks: CouncilTask[];
  wakes: CouncilWakeEvent[];
  managed: CouncilManagedPublicView | null;
}

export interface CouncilSyncSnapshotEnvelope {
  schemaVersion: 1;
  state: CouncilPublicSnapshot;
  cursor: string;
  generatedAt: string;
}

export interface CouncilOwnerSupervisorApi {
  status: () => unknown;
  setManager: (agentId?: string) => unknown;
  runNow: () => Promise<unknown>;
  history: () => unknown;
  observation: (runId: string) => unknown;
  screenshot: (runId: string, screenshotId: string) => Buffer | undefined;
  deleteObservation: (runId: string) => boolean;
  clearHistory: () => number;
}

export interface CouncilOwnerApi {
  token: () => string | undefined;
  startLead: (input: { conversationUrl: string; projectName: string }) => Promise<unknown>;
  supervisor?: CouncilOwnerSupervisorApi;
}

function canonicalPublicWake(wake: CouncilWakeEvent): CouncilWakeEvent {
  return {
    ...wake,
    status: normalizeCouncilWakeStatus(wake.status),
    transitions: wake.transitions?.map(transition => ({ ...transition, status: normalizeCouncilWakeStatus(transition.status) })),
  };
}

function buildCouncilPublicSnapshotFromState(state: CouncilState, presence: CouncilAgentPresence[], managed: CouncilManagedPublicView | null, generatedAt: string): CouncilPublicSnapshot {
  return {
    version: 1,
    generatedAt,
    agents: state.agents,
    presence,
    rooms: state.rooms,
    messages: state.messages.slice(-600),
    decisions: state.decisions.slice(-120),
    tasks: state.tasks.slice(-300),
    wakes: state.wakes.slice(-160).map(canonicalPublicWake),
    managed: managed ? structuredClone(managed) : null,
  };
}

export function buildCouncilPublicSnapshot(store: CouncilStore, managed: CouncilManagedPublicView | null = null): CouncilPublicSnapshot {
  const generatedAt = new Date().toISOString();
  return buildCouncilPublicSnapshotFromState(store.snapshot(), store.presenceSnapshot(generatedAt), managed, generatedAt);
}

function allowedRendererOrigin(request: Request): string | undefined {
  const origin = request.headers.get("origin");
  if (origin === "null") return "null";
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    if ((url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) return origin;
  } catch {}
  return undefined;
}

function responseHeaders(origin?: string, contentType = "application/json; charset=utf-8"): HeadersInit {
  return {
    ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
    "cache-control": "no-store",
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  };
}

function configuredPort(): number {
  const raw = process.env.CODEXWEB_COUNCIL_UI_PORT?.trim();
  if (!raw) return COUNCIL_HTTP_DEFAULT_PORT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error("CODEXWEB_COUNCIL_UI_PORT must be an integer from 1 to 65535");
  return value;
}

function syncWaitMilliseconds(url: URL): number {
  const raw = url.searchParams.get("wait_ms");
  if (raw === null || raw === "") return DEFAULT_SYNC_WAIT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error("wait_ms must be a non-negative integer");
  return Math.min(value, MAX_SYNC_WAIT_MS);
}

function encodeCursor(epoch: string, revision: number): string {
  return Buffer.from(JSON.stringify({ e: epoch, r: revision }), "utf8").toString("base64url");
}

function decodeCursor(value: string | null): { epoch: string; revision: number } | undefined {
  if (!value || Buffer.byteLength(value, "utf8") > MAX_SYNC_CURSOR_BYTES) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.e !== "string" || parsed.e.length < 8 || typeof parsed.r !== "number" || !Number.isSafeInteger(parsed.r) || parsed.r < 0) return undefined;
    return { epoch: parsed.e, revision: parsed.r };
  } catch { return undefined; }
}

async function parseOwnerJson(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > OWNER_BODY_LIMIT) throw new Error("owner request is too large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > OWNER_BODY_LIMIT) throw new Error("owner request is too large");
  if (!text) return {};
  const body = JSON.parse(text) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("owner request is invalid");
  return body as Record<string, unknown>;
}

function ownerString(body: Record<string, unknown>, key: string, max = 160): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${key} is invalid`);
  return value.trim();
}

function ownerId(body: Record<string, unknown>, key: string): string {
  const value = ownerString(body, key, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`${key} is invalid`);
  return value;
}

export function startCouncilHttpServer(
  store: CouncilStore,
  options: { port?: number; onError?: (message: string) => void; managedSnapshot?: () => CouncilManagedPublicView | null; owner?: CouncilOwnerApi } = {},
): ReturnType<typeof Bun.serve> | undefined {
  const port = options.port ?? configuredPort();
  const syncEpoch = randomUUID();

  const managedView = (): CouncilManagedPublicView | null => {
    try { return options.managedSnapshot?.() ?? null; }
    catch (error) {
      options.onError?.(`managed snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const syncSnapshot = (): CouncilSyncSnapshotEnvelope => {
    const versioned = store.snapshotWithRevision();
    const generatedAt = new Date().toISOString();
    return {
      schemaVersion: 1,
      state: buildCouncilPublicSnapshotFromState(versioned.state, store.presenceSnapshot(generatedAt), managedView(), generatedAt),
      cursor: encodeCursor(syncEpoch, versioned.revision),
      generatedAt,
    };
  };

  const resyncRequired = (origin?: string) => Response.json({
    schemaVersion: 1,
    type: "resync-required",
    reason: { code: "RESYNC_REQUIRED" },
  }, { status: 409, headers: responseHeaders(origin) });

  const ownerAuthorized = (request: Request): boolean => {
    if (request.headers.has("origin")) return false;
    const token = options.owner?.token();
    return Boolean(token && ownerBearerMatches(token!, request.headers.get("authorization")));
  };

  const ownerJson = (result: unknown, status = 200) => Response.json({ ok: status < 400, ...(status < 400 ? { result } : { error: result }) }, { status, headers: responseHeaders() });

  try {
    return Bun.serve({
      hostname: COUNCIL_HTTP_HOST,
      port,
      async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname.startsWith("/api/owner/")) {
          if (request.headers.has("origin")) return new Response("Forbidden origin", { status: 403, headers: responseHeaders(undefined, "text/plain; charset=utf-8") });
          if (!ownerAuthorized(request)) return new Response("Unauthorized", { status: 401, headers: responseHeaders(undefined, "text/plain; charset=utf-8") });
          if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: responseHeaders(undefined, "text/plain; charset=utf-8") });
          try {
            const body = await parseOwnerJson(request);
            if (url.pathname === "/api/owner/start-lead") {
              const conversationUrl = ownerString(body, "conversation_url", 1_000);
              const projectName = ownerString(body, "project_name", 160);
              return ownerJson(await options.owner!.startLead({ conversationUrl, projectName }));
            }
            const supervisor = options.owner?.supervisor;
            if (!supervisor) return ownerJson("Council supervisor is unavailable", 503);
            if (url.pathname === "/api/owner/supervisor/status") return ownerJson(supervisor.status());
            if (url.pathname === "/api/owner/supervisor/manager") {
              const raw = body.agent_id;
              if (raw !== null && raw !== undefined && typeof raw !== "string") throw new Error("agent_id is invalid");
              const agentId = typeof raw === "string" && raw.trim() ? ownerId(body, "agent_id") : undefined;
              return ownerJson(supervisor.setManager(agentId));
            }
            if (url.pathname === "/api/owner/supervisor/run") return ownerJson(await supervisor.runNow());
            if (url.pathname === "/api/owner/observations/list") return ownerJson(supervisor.history());
            if (url.pathname === "/api/owner/observations/read") {
              const value = supervisor.observation(ownerId(body, "run_id"));
              return value ? ownerJson(value) : ownerJson("Observation does not exist", 404);
            }
            if (url.pathname === "/api/owner/observations/screenshot") {
              const runId = ownerId(body, "run_id");
              const screenshotId = ownerString(body, "screenshot_id", 180);
              if (!/^[A-Za-z0-9._-]{8,160}\.png$/.test(screenshotId)) throw new Error("screenshot_id is invalid");
              const png = supervisor.screenshot(runId, screenshotId);
              if (!png) return ownerJson("Observation screenshot does not exist", 404);
              return new Response(Uint8Array.from(png), { status: 200, headers: responseHeaders(undefined, "image/png") });
            }
            if (url.pathname === "/api/owner/observations/delete") return ownerJson({ deleted: supervisor.deleteObservation(ownerId(body, "run_id")) });
            if (url.pathname === "/api/owner/observations/clear") return ownerJson({ deleted: supervisor.clearHistory() });
            return ownerJson("Unknown owner operation", 404);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            options.onError?.(`owner request failed: ${message}`);
            return ownerJson(message, 400);
          }
        }

        const origin = allowedRendererOrigin(request);
        const suppliedOrigin = request.headers.has("origin");
        if (suppliedOrigin && !origin) return new Response("Forbidden origin", { status: 403, headers: responseHeaders(undefined, "text/plain; charset=utf-8") });
        if (request.method === "OPTIONS") {
          if (!origin) return new Response("Forbidden origin", { status: 403, headers: responseHeaders(undefined, "text/plain; charset=utf-8") });
          return new Response(null, { status: 204, headers: { ...responseHeaders(origin), "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type" } });
        }
        if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true, product: "codexweb-council", port }, { headers: responseHeaders(origin) });
        if (request.method === "GET" && url.pathname === "/api/state") return Response.json(buildCouncilPublicSnapshot(store, managedView()), { headers: responseHeaders(origin) });
        if (request.method === "GET" && url.pathname === "/api/sync/snapshot") return Response.json(syncSnapshot(), { headers: responseHeaders(origin) });
        if (request.method === "GET" && url.pathname === "/api/sync/next") {
          const cursor = decodeCursor(url.searchParams.get("after"));
          const currentRevision = store.currentRevision();
          if (!cursor || cursor.epoch !== syncEpoch || cursor.revision > currentRevision) return resyncRequired(origin);
          if (cursor.revision < currentRevision) return Response.json(syncSnapshot(), { headers: responseHeaders(origin) });

          let waitMs: number;
          try { waitMs = syncWaitMilliseconds(url); }
          catch { return Response.json({ schemaVersion: 1, type: "invalid-request", reason: { code: "INVALID_WAIT" } }, { status: 400, headers: responseHeaders(origin) }); }

          const changed = await new Promise<boolean>(resolve => {
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const finish = (value: boolean) => {
              if (settled) return;
              settled = true;
              unsubscribe();
              if (timer) clearTimeout(timer);
              request.signal.removeEventListener("abort", onAbort);
              resolve(value);
            };
            const onAbort = () => finish(false);
            const unsubscribe = store.onMutation(revision => { if (revision !== cursor.revision) finish(true); });
            request.signal.addEventListener("abort", onAbort, { once: true });
            if (store.currentRevision() !== cursor.revision) finish(true);
            else timer = setTimeout(() => finish(false), waitMs);
          });

          if (!changed) return new Response(null, { status: 204, headers: responseHeaders(origin) });
          return Response.json(syncSnapshot(), { headers: responseHeaders(origin) });
        }
        return new Response("Not found", { status: 404, headers: responseHeaders(origin, "text/plain; charset=utf-8") });
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onError?.(message);
    return undefined;
  }
}
