import { CouncilStore } from "./store";
import type { CouncilAgent, CouncilDecision, CouncilMessage, CouncilRoom, CouncilTask, CouncilWakeEvent } from "./types";

export const COUNCIL_HTTP_HOST = "127.0.0.1";
export const COUNCIL_HTTP_DEFAULT_PORT = 17_842;

export interface CouncilPublicSnapshot {
  version: 1;
  generatedAt: string;
  agents: CouncilAgent[];
  rooms: CouncilRoom[];
  messages: CouncilMessage[];
  decisions: CouncilDecision[];
  tasks: CouncilTask[];
  wakes: CouncilWakeEvent[];
}

export function buildCouncilPublicSnapshot(store: CouncilStore): CouncilPublicSnapshot {
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
  };
}

function allowedRendererOrigin(request: Request): string | undefined {
  const origin = request.headers.get("origin");
  if (origin === "null") return "null"; // packaged file:// Electron renderer
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    if ((url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
      return origin;
    }
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

export function startCouncilHttpServer(store: CouncilStore, options: { port?: number; onError?: (message: string) => void } = {}): ReturnType<typeof Bun.serve> | undefined {
  const port = options.port ?? configuredPort();
  try {
    return Bun.serve({
      hostname: COUNCIL_HTTP_HOST,
      port,
      fetch(request) {
        const url = new URL(request.url);
        const origin = allowedRendererOrigin(request);
        const suppliedOrigin = request.headers.has("origin");
        if (suppliedOrigin && !origin) return new Response("Forbidden origin", { status: 403, headers: responseHeaders(undefined, "text/plain; charset=utf-8") });
        if (request.method === "OPTIONS") {
          if (!origin) return new Response("Forbidden origin", { status: 403, headers: responseHeaders(undefined, "text/plain; charset=utf-8") });
          return new Response(null, { status: 204, headers: { ...responseHeaders(origin), "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type" } });
        }
        if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true, product: "codexweb-council", port }, { headers: responseHeaders(origin) });
        if (request.method === "GET" && url.pathname === "/api/state") return Response.json(buildCouncilPublicSnapshot(store), { headers: responseHeaders(origin) });
        return new Response("Not found", { status: 404, headers: responseHeaders(origin, "text/plain; charset=utf-8") });
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onError?.(message);
    return undefined;
  }
}
