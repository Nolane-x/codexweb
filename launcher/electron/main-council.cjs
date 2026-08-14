// Council entrypoint: patch only the two browser control classes, then load the preserved launcher main.
// This keeps the original Electron shell/login/tunnel implementation intact and reversible.
const browserHostModule = require("./browser-host.cjs");
const controlServerModule = require("./control-server.cjs");
const { createCouncilBrowserHostClass } = require("./council-browser-host.cjs");
const { createCouncilBrowserControlServerClass } = require("./council-control-server.cjs");

browserHostModule.BrowserHost = createCouncilBrowserHostClass(browserHostModule.BrowserHost);
controlServerModule.BrowserControlServer = createCouncilBrowserControlServerClass(controlServerModule.BrowserControlServer);

require("./main.cjs");
