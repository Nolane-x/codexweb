import { readLauncherBrowserHostDescriptor } from "../launcher-browser-host";

export interface LauncherPersistentTurnControlDeps {
  readDescriptor: (path: string) => { control: { endpoint: string; token: string } };
  fetchImpl: typeof fetch;
}

export function createLauncherPersistentTurnControl(
  descriptorPath: string,
  dependencies: Partial<LauncherPersistentTurnControlDeps> = {},
) {
  const deps: LauncherPersistentTurnControlDeps = {
    readDescriptor: dependencies.readDescriptor ?? readLauncherBrowserHostDescriptor,
    fetchImpl: dependencies.fetchImpl ?? fetch,
  };
  const request = async (path: string, body: Record<string, unknown>) => {
    const descriptor = deps.readDescriptor(descriptorPath);
    const endpoint = new URL(descriptor.control.endpoint);
    if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port) throw new Error("launcher control endpoint must be loopback");
    const response = await deps.fetchImpl(`${endpoint.origin}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${descriptor.control.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : `launcher control HTTP ${response.status}`);
    return value;
  };
  return {
    async start(input: { traceId: string; bindingKey: string }) {
      const value = await request("/v1/turn/start", { phase: "start", traceId: input.traceId, helperPid: process.pid, bindingKey: input.bindingKey });
      if (typeof value.surfaceId !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(value.surfaceId)) throw new Error("launcher returned invalid surfaceId");
      return { surfaceId: value.surfaceId };
    },
    async heartbeat(input: { traceId: string }) { await request("/v1/turn/heartbeat", { phase: "heartbeat", traceId: input.traceId, helperPid: process.pid }); },
    async end(input: { traceId: string; status: "completed" | "failed" | "aborted"; message?: string }) {
      await request("/v1/turn/end", { phase: "end", traceId: input.traceId, helperPid: process.pid, status: input.status, ...(input.message ? { message: input.message } : {}) });
    },
  };
}
