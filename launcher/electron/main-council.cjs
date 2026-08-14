// Council entrypoint: patch only bounded extension points, then load the preserved launcher main.
// This keeps the original Electron shell/login/tunnel implementation intact and reversible.
const browserHostModule = require("./browser-host.cjs");
const controlServerModule = require("./control-server.cjs");
const runtimeModule = require("./runtime.cjs");
const updateModule = require("./update.cjs");
const { createCouncilBrowserHostClass } = require("./council-browser-host.cjs");
const { createCouncilBrowserControlServerClass } = require("./council-control-server.cjs");
const councilUpdateModule = require("./council-update.cjs");

browserHostModule.BrowserHost = createCouncilBrowserHostClass(browserHostModule.BrowserHost);
controlServerModule.BrowserControlServer = createCouncilBrowserControlServerClass(controlServerModule.BrowserControlServer);
const CouncilRuntimeHost = class extends runtimeModule.RuntimeHost {
  setupMcp(options) {
    return this.setupCouncilMcp(options);
  }
};
runtimeModule.RuntimeHost = CouncilRuntimeHost;
updateModule.createUpdateController = councilUpdateModule.createUpdateController;

require("./main.cjs");
