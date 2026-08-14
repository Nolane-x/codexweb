// Standalone Council product boundary. This flag is set before any shared launcher module loads,
// so runtime supervision must treat legacy Codex configs as foreign and never migrate/start them.
process.env.CODEXWEB_COUNCIL_PRODUCT = "1";

const browserHostModule = require("./browser-host.cjs");
const controlServerModule = require("./control-server.cjs");
const runtimeModule = require("./runtime.cjs");
const runtimeSupervisorModule = require("./runtime-supervisor.cjs");
const updateModule = require("./update.cjs");
const { createCouncilBrowserHostClass } = require("./council-browser-host.cjs");
const { createCouncilBrowserControlServerClass } = require("./council-control-server.cjs");
const councilUpdateModule = require("./council-update.cjs");

browserHostModule.BrowserHost = createCouncilBrowserHostClass(browserHostModule.BrowserHost);
controlServerModule.BrowserControlServer = createCouncilBrowserControlServerClass(controlServerModule.BrowserControlServer);

// RuntimeHost and RuntimeSupervisor are already Council-aware; product mode makes every legacy
// config fail closed instead of falling back to the retired Codex runtime path.
const CouncilRuntimeHost = class extends runtimeModule.RuntimeHost {
  setupMcp(options) { return this.setupCouncilMcp(options); }
};
runtimeModule.RuntimeHost = CouncilRuntimeHost;
runtimeSupervisorModule.RuntimeSupervisor = runtimeSupervisorModule.RuntimeSupervisor;
updateModule.createUpdateController = councilUpdateModule.createUpdateController;

require("./main.cjs");
