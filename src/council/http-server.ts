import { ownerBearerMatches } from "./owner-control";
import type { PublicManagedAgent } from "./managed-runtime";
import type { ManagedCouncilProject } from "./managed-project-state";
import { CouncilStore } from "./store";
import type { CouncilAgent, CouncilDecision, CouncilMessage, CouncilRoom, CouncilTask, CouncilWakeEvent } from "./types";

export const COUNCIL_HTTP_HOST = "127.0.0.1";
export const COUNCIL_HTTP_DEFAULT_PORT = 17_842;
const OWNER_BODY_LIMIT = 16 * 1024;

export interface CouncilManagedPublicView {
  project: ManagedCouncilProject | null;
  agents: PublicManagedAgent[];
}

export interface CouncilPublicSnapshot {
  version: 1;
  generatedAt: string;
  agents: CouncilAgent[];
  rooms: CouncilRoom[];
  messages: CouncilMessage[];
  decisions: CouncilDecision[];
  tasks: CouncilTask[];
  wakes: CouncilWakeEvent[];
  managed: CouncilManagedPublicView | null;
}

export interface CouncilOwnerApi {
  token: () => string | undefined;
  startLead: (input: { conversationUrl: string; projectName: string }) => Promise<unknown>;
}

export function buildCouncilPublicSnapshot(store: CouncilStore, managed: CouncilManagedPublicView | null = null): CouncilPublicSnapshot {
  const state = store.snapshot();
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    agents: state.agents,
    rooms: state.rooms,
    messages: state.messages.slice(-600),
    decisions: state.decisions.slice(-120),
    tasks: state.tasks.slice(-300),
    wakes: state.wakes.slice(-160),
    managed: managed ? structuredClone(managed) : null,
  };
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

async function parseOwnerBody(request: Request): Promise<{ conversationUrl: string; projectName: string }> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > OWNER_BODY_LIMIT) throw new Error("owner request is too large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > OWNER_BODY_LIMIT) throw new Error("owner request is too large");
  const body = JSON.parse(text) as Record<string, unknown>;
  if (typeof body.conversation_url !== "string" || typeof body.project_name !== "string") throw new Error("owner request is invalid");
  return { conversationUrl: body.conversation_url, projectName: body.project_name };
}

export function startCouncilHttpServer(
  store: CouncilStore,
  options: { port?: number; onError?: (message: string) => void; managedSnapshot?: () => CouncilManagedPublicView | null; owner?: CouncilOwnerApi } = {},
): ReturnType<typeof Bun.serve> | undefined {
  const port = options.port ?? configuredPort();
  try {
    return Bun.serve({
      hostname: COUNCIL_HTTP_HOST,
      port,
      async fetch(request) {
        const url = new URL(request.url);

        if (request.method === "POST" && url.pathname === "/api/owner/start-lead") {
          // Owner control is intentionally not a browser API. Any Origin means the request came
          // through a renderer/web page and is rejected even if it is local/file://.
          if (request.headers.has("origin")) return new Response("Forbidden origin", { status: 403, headers: responseHeaders(undefined, "text/plain; charset=utf-8") });
          const token = options.owner?.token();
          if (!token || !ownerBearerMatches(token, request.headers.get("authorization"))) {
            return new Response("Unauthorized", { status: 401, headers: responseHeaders(undefined, "text/plain; charset=utf-8") });
          }
          try {
            const input = await parseOwnerBody(request);
            const result = await options.owner!.startLead(input);
            return Response.json({ ok: true, result }, { headers: responseHeaders() });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            options.onError?.(`owner start-lead failed: ${message}`);
            return Response.json({ ok: false, error: message }, { status: 400, headers: responseHeaders() });
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
        if (request.method === "GET" && url.pathname === "/api/state") {
          let managed: CouncilManagedPublicView | null = null;
          try { managed = options.managedSnapshot?.() ?? null; }
          catch (error) { options.onError?.(`managed snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`); }
          return Response.json(buildCouncilPublicSnapshot(store, managed), { headers: responseHeaders(origin) });
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
