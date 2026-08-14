const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OWNER_REQUEST_TIMEOUT_MS = 8_000;

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

async function bindCurrentConversationAsLead({ conversationUrl, projectName }, options = {}) {
  const { endpoint, token } = readOwnerDescriptor();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Council owner-control fetch is unavailable");
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(100, Math.min(30_000, Math.trunc(options.timeoutMs))) : OWNER_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  // This deadline intentionally stays referenced: a Council bind request must settle or abort
  // deterministically even if no other event-loop handles remain.
  const timer = setTimeout(() => controller.abort(new Error("Council owner-control request timed out")), timeoutMs);
  try {
    const response = await fetchImpl(`${endpoint}/start-lead`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        conversation_url: assertConversationUrl(conversationUrl),
        project_name: String(projectName || "ChatGPT Project").trim().slice(0, 160) || "ChatGPT Project",
      }),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok || value?.ok !== true) throw new Error(typeof value?.error === "string" ? value.error : `Council owner control HTTP ${response.status}`);
    return value.result;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { OWNER_REQUEST_TIMEOUT_MS, assertConversationUrl, bindCurrentConversationAsLead, ownerDescriptorPath, readOwnerDescriptor };
