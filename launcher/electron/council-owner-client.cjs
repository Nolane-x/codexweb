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

function assertId(value, label) {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function safeLimit(value, fallback, max) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error("limit is invalid");
  return Math.min(max, value);
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

async function focusAgentConversation(agentId, options = {}) {
  return await ownerRequest("agent/focus", { agent_id: assertId(agentId, "agentId") }, { ...options, timeoutMs: options.timeoutMs ?? OWNER_LONG_REQUEST_TIMEOUT_MS });
}

async function supervisorStatus(options = {}) { return await ownerRequest("supervisor/status", {}, options); }
async function setSupervisorManager(agentId, options = {}) { return await ownerRequest("supervisor/manager", { agent_id: agentId || null }, options); }
async function runSupervisorNow(options = {}) { return await ownerRequest("supervisor/run", {}, { ...options, timeoutMs: options.timeoutMs ?? OWNER_LONG_REQUEST_TIMEOUT_MS }); }
async function listObservations(options = {}) { return await ownerRequest("observations/list", {}, options); }
async function observationStorageStats(options = {}) { return await ownerRequest("observations/storage", {}, options); }
async function readObservation(runId, options = {}) { return await ownerRequest("observations/read", { run_id: assertId(runId, "runId") }, options); }
async function deleteObservation(runId, options = {}) { return await ownerRequest("observations/delete", { run_id: assertId(runId, "runId") }, options); }
async function clearObservations(options = {}) { return await ownerRequest("observations/clear", {}, options); }
async function readObservationScreenshot(runId, screenshotId, options = {}) {
  const buffer = await ownerRequest("observations/screenshot", { run_id: assertId(runId, "runId"), screenshot_id: String(screenshotId || "") }, { ...options, binary: true });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function autonomyStatus(options = {}) { return await ownerRequest("autonomy/status", {}, options); }
async function listExceptionalWork(options = {}) { return await ownerRequest("autonomy/exceptional", {}, options); }
async function cancelExceptionalWork(workItemId, options = {}) { return await ownerRequest("autonomy/cancel", { work_item_id: assertId(workItemId, "workItemId") }, options); }
async function retryUncertainWork(workItemId, options = {}) { return await ownerRequest("autonomy/retry-uncertain", { work_item_id: assertId(workItemId, "workItemId") }, options); }

async function memoryStats(roomId, options = {}) {
  return await ownerRequest("memory/stats", roomId ? { room_id: assertId(roomId, "roomId") } : {}, options);
}
async function memorySearch(roomId, query, limit = 20, options = {}) {
  const text = String(query ?? "").trim();
  if (text.length < 2 || text.length > 500) throw new Error("memory query is invalid");
  return await ownerRequest("memory/search", { room_id: assertId(roomId, "roomId"), query: text, limit: safeLimit(limit, 20, 50) }, options);
}
async function memoryRecent(roomId, limit = 30, options = {}) {
  return await ownerRequest("memory/recent", { room_id: assertId(roomId, "roomId"), limit: safeLimit(limit, 30, 100) }, options);
}
async function clearProjectMemory(roomId, options = {}) {
  return await ownerRequest("memory/clear-project", { room_id: assertId(roomId, "roomId") }, options);
}

module.exports = {
  OWNER_REQUEST_TIMEOUT_MS,
  OWNER_LONG_REQUEST_TIMEOUT_MS,
  assertConversationUrl,
  autonomyStatus,
  bindCurrentConversationAsLead,
  cancelExceptionalWork,
  focusAgentConversation,
  clearObservations,
  clearProjectMemory,
  deleteObservation,
  listExceptionalWork,
  listObservations,
  memoryRecent,
  memorySearch,
  memoryStats,
  observationStorageStats,
  ownerDescriptorPath,
  ownerRequest,
  readObservation,
  readObservationScreenshot,
  readOwnerDescriptor,
  retryUncertainWork,
  runSupervisorNow,
  setSupervisorManager,
  supervisorStatus,
};
