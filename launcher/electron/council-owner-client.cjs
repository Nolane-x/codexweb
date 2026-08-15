const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OWNER_REQUEST_TIMEOUT_MS = 8_000;
const OWNER_LONG_REQUEST_TIMEOUT_MS = 20 * 60_000;

function configRoot() {
  const override = process.env.CODEX_CHATGPT_WEB_HOME?.trim();
  return override ? path.resolve(override) : path.join(os.homedir(), ".codex-chatgpt-web");
}

function ownerDescriptorPath() {
  return path.join(configRoot(), "council", "owner-control.json");
}

function readOwnerDescriptor() {
  const descriptorPath = ownerDescriptorPath();
  const value = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  if (value?.version !== 1 || typeof value.endpoint !== "string" || typeof value.token !== "string" || value.token.length < 32) {
    throw new Error("Council owner-control descriptor is invalid; reconnect the Council runtime");
  }
  const endpoint = new URL(value.endpoint);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.pathname !== "/api/owner" || !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Council owner-control endpoint is not the expected loopback endpoint");
  }
  return { endpoint: endpoint.toString().replace(/\/$/, ""), token: value.token };
}

function assertConversationUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || !/^\/c\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.username || url.password || url.search || url.hash) {
    throw new Error("Open a persistent ChatGPT conversation before binding it as Council Lead");
  }
  return url.toString();
}

async function ownerRequest(operation, body = {}, options = {}) {
  if (typeof operation !== "string" || !/^[a-z0-9/-]+$/.test(operation) || operation.includes("..")) throw new Error("Council owner operation is invalid");
  const { endpoint, token } = readOwnerDescriptor();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Council owner-control fetch is unavailable");
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(100, Math.min(30 * 60_000, Math.trunc(options.timeoutMs))) : OWNER_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Council owner-control request timed out")), timeoutMs);
  try {
    const response = await fetchImpl(`${endpoint}/${operation}`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (options.binary === true) {
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png")) {
        const value = await response.json().catch(() => ({}));
        throw new Error(typeof value?.error === "string" ? value.error : `Council owner control HTTP ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    }
    const value = await response.json().catch(() => ({}));
    if (!response.ok || value?.ok !== true) throw new Error(typeof value?.error === "string" ? value.error : `Council owner control HTTP ${response.status}`);
    return value.result;
  } finally {
    clearTimeout(timer);
  }
}

async function bindCurrentConversationAsLead({ conversationUrl, projectName }, options = {}) {
  return await ownerRequest("start-lead", {
    conversation_url: assertConversationUrl(conversationUrl),
    project_name: String(projectName || "ChatGPT Project").trim().slice(0, 160) || "ChatGPT Project",
  }, options);
}

async function supervisorStatus(options = {}) { return await ownerRequest("supervisor/status", {}, options); }
async function setSupervisorManager(agentId, options = {}) { return await ownerRequest("supervisor/manager", { agent_id: agentId || null }, options); }
async function runSupervisorNow(options = {}) { return await ownerRequest("supervisor/run", {}, { ...options, timeoutMs: options.timeoutMs ?? OWNER_LONG_REQUEST_TIMEOUT_MS }); }
async function listObservations(options = {}) { return await ownerRequest("observations/list", {}, options); }
async function readObservation(runId, options = {}) { return await ownerRequest("observations/read", { run_id: runId }, options); }
async function deleteObservation(runId, options = {}) { return await ownerRequest("observations/delete", { run_id: runId }, options); }
async function clearObservations(options = {}) { return await ownerRequest("observations/clear", {}, options); }
async function readObservationScreenshot(runId, screenshotId, options = {}) {
  const buffer = await ownerRequest("observations/screenshot", { run_id: runId, screenshot_id: screenshotId }, { ...options, binary: true });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

module.exports = {
  OWNER_REQUEST_TIMEOUT_MS,
  OWNER_LONG_REQUEST_TIMEOUT_MS,
  assertConversationUrl,
  bindCurrentConversationAsLead,
  clearObservations,
  deleteObservation,
  listObservations,
  ownerDescriptorPath,
  ownerRequest,
  readObservation,
  readObservationScreenshot,
  readOwnerDescriptor,
  runSupervisorNow,
  setSupervisorManager,
  supervisorStatus,
};
