const { timingSafeEqual } = require("node:crypto");
const { BINDING_KEY } = require("./agent-surface-registry.cjs");

const MAX_BODY_BYTES = 16 * 1024;

function parseCouncilTurnStart(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("turn start body is invalid");
  const allowed = new Set(["traceId", "helperPid", "bindingKey"]);
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw new Error(`unknown turn-start field: ${key}`);
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(body.traceId || "")) throw new Error("traceId is invalid");
  if (!Number.isInteger(body.helperPid) || body.helperPid < 1) throw new Error("browser helper pid is invalid");
  if (body.bindingKey !== undefined && (typeof body.bindingKey !== "string" || !BINDING_KEY.test(body.bindingKey))) throw new Error("bindingKey is invalid");
  return { traceId: body.traceId, helperPid: body.helperPid, ...(body.bindingKey ? { bindingKey: body.bindingKey } : {}) };
}

function secureTokenMatches(expected, authorization) {
  const prefix = "Bearer ";
  if (typeof authorization !== "string" || !authorization.startsWith(prefix)) return false;
  const supplied = Buffer.from(authorization.slice(prefix.length));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) throw new Error("request body is empty");
  return JSON.parse(text);
}

function writeJson(response, status, body) {
  const encoded = Buffer.from(`${JSON.stringify(body)}\n`);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": String(encoded.length),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(encoded);
}

function createCouncilBrowserControlServerClass(LegacyBrowserControlServer) {
  return class CouncilBrowserControlServer extends LegacyBrowserControlServer {
    async handle(request, response) {
      if (request.method !== "POST" || request.url !== "/v1/turn/start") return await super.handle(request, response);
      if (!secureTokenMatches(this.token, request.headers.authorization)) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }
      try {
        const body = parseCouncilTurnStart(await readJson(request));
        const host = this.getBrowserHost();
        if (!host) throw new Error("browser host is not ready");
        const preferences = this.getPreferences();
        const lease = host.beginTurn(body.traceId, preferences.showBrowserDuringTurns === true, body.helperPid, body.bindingKey);
        this.logger.info("browser.turn_started", { traceId: body.traceId, ...(body.bindingKey ? { bindingKey: body.bindingKey } : {}) });
        writeJson(response, 200, { ok: true, ...lease });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn("browser.control_rejected", { message });
        writeJson(response, 400, { error: message });
      }
    }
  };
}

module.exports = { parseCouncilTurnStart, createCouncilBrowserControlServerClass };
