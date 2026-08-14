// Standalone Council product boundary. This flag is set before any shared launcher module loads,
// so runtime supervision must treat legacy Codex configs as foreign and never migrate/start them.
process.env.CODEXWEB_COUNCIL_PRODUCT = "1";

const { ipcMain } = require("electron");
const browserHostModule = require("./browser-host.cjs");
const controlServerModule = require("./control-server.cjs");
const runtimeModule = require("./runtime.cjs");
const updateModule = require("./update.cjs");
const { createCouncilBrowserHostClass, getCurrentCouncilBrowserHost } = require("./council-browser-host.cjs");
const { createCouncilBrowserControlServerClass } = require("./council-control-server.cjs");
const { bindCurrentConversationAsLead } = require("./council-owner-client.cjs");
const councilUpdateModule = require("./council-update.cjs");

browserHostModule.BrowserHost = createCouncilBrowserHostClass(browserHostModule.BrowserHost);
controlServerModule.BrowserControlServer = createCouncilBrowserControlServerClass(controlServerModule.BrowserControlServer);

const CouncilRuntimeHost = class extends runtimeModule.RuntimeHost {
  setupMcp(options) { return this.setupCouncilMcp(options); }
};
runtimeModule.RuntimeHost = CouncilRuntimeHost;
updateModule.createUpdateController = councilUpdateModule.createUpdateController;

// The renderer can request "bind current" but cannot supply or observe the conversation URL,
// owner bearer, agent id, role, or permissions. Electron main derives the exact ChatGPT URL.
ipcMain.handle("launcher:council-bind-current-lead", async (_event, input = {}) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Council lead binding input is invalid");
  const unexpected = Object.keys(input).filter(key => key !== "projectName");
  if (unexpected.length > 0) throw new Error(`Council lead binding rejects renderer-controlled fields: ${unexpected.join(", ")}`);
  const host = getCurrentCouncilBrowserHost();
  if (!host) throw new Error("ChatGPT browser is not ready");
  const browser = host.snapshot();
  if (browser.authenticated !== true) throw new Error("Sign in to ChatGPT before binding a Council Lead");
  const conversationUrl = host.currentHomeConversationUrl();
  const projectName = typeof input.projectName === "string" ? input.projectName.trim().slice(0, 160) : "ChatGPT Project";
  return await bindCurrentConversationAsLead({ conversationUrl, projectName: projectName || "ChatGPT Project" });
});

require("./main.cjs");
