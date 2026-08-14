process.env.CODEXWEB_COUNCIL_PRODUCT = "1";

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  Tray,
} = require("electron");
const browserHostModule = require("./browser-host.cjs");
const controlServerModule = require("./control-server.cjs");
const { createCouncilBrowserHostClass } = require("./council-browser-host.cjs");
const { createCouncilBrowserControlServerClass } = require("./council-control-server.cjs");
const { CouncilConnectionSupervisor } = require("./council-connection-supervisor.cjs");
const { bindCurrentConversationAsLead } = require("./council-owner-client.cjs");
const { getAutostart, setAutostart } = require("./autostart.cjs");
const { createLogger, installProcessDiagnosticGuards, registerLoggedIpc } = require("./logging.cjs");
const { RuntimeHost, COUNCIL_CONNECTOR_NAME } = require("./runtime.cjs");
const { ensurePackagedRuntime } = require("./runtime-install.cjs");
const { RuntimeSupervisor } = require("./runtime-supervisor.cjs");
const { runtimeBundlePaths } = require("./runtime-command.cjs");
const { createUpdateController } = require("./council-update.cjs");
const { createStateStore, nextSessionRefreshReminderAt, validateSidebarState } = require("./state.cjs");
const { MIN_WINDOW_BOUNDS, readWindowState, trackWindowState } = require("./window-state.cjs");

const BrowserHost = createCouncilBrowserHostClass(browserHostModule.BrowserHost);
const BrowserControlServer = createCouncilBrowserControlServerClass(controlServerModule.BrowserControlServer);
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const SOURCE_ROOT = path.resolve(__dirname, "../..");
const CORE_HOME = process.env.CODEX_CHATGPT_WEB_HOME?.trim()
  ? path.resolve(process.env.CODEX_CHATGPT_WEB_HOME.trim())
  : path.join(os.homedir(), ".codex-chatgpt-web");
const BROWSER_DESCRIPTOR_PATH = path.join(CORE_HOME, "runtime", "launcher-browser.json");
const BROWSER_HELPER_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "runtime", "app", "browser-helper.cjs")
  : path.join(SOURCE_ROOT, ".launcher-runtime", "browser-helper.cjs");
const GITHUB_URL = "https://github.com/Nolane-x/codexweb";
const CONNECTORS_URL = "https://chatgpt.com/#settings/Plugins";
const TUNNELS_URL = "https://platform.openai.com/settings/organization/tunnels";
const KEYS_URL = "https://platform.openai.com/settings/organization/api-keys";
const ALLOWED_EXTERNAL_URLS = new Set([GITHUB_URL, CONNECTORS_URL, TUNNELS_URL, KEYS_URL]);
const PACKAGED_RENDERER_URL = pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).href;
const APP_ICON_PATH = path.join(__dirname, "..", "assets", "icon.png");

app.setName("CodexWeb Council");
if (process.platform === "win32") app.setAppUserModelId("dev.codexwebgpt.launcher");
// Keep the old data directory only for seamless ChatGPT login/update continuity. Council never
// reads or mutates CODEX_HOME / ~/.codex from this launcher.
const configuredUserData = process.env.CODEX_WEB_GPT_LAUNCHER_DATA_DIR?.trim();
const launcherUserData = configuredUserData ? path.resolve(configuredUserData) : path.join(app.getPath("appData"), "Codex Web GPT");
fs.mkdirSync(launcherUserData, { recursive: true, mode: 0o700 });
if (process.platform !== "win32") fs.chmodSync(launcherUserData, 0o700);
app.setPath("userData", launcherUserData);
installProcessDiagnosticGuards({ filePath: path.join(launcherUserData, "logs", "process-stream-errors.log") });

let mainWindow = null;
let browserHost = null;
let browserControl = null;
let runtimeHost = null;
let runtimeSupervisor = null;
let councilConnectionSupervisor = null;
let updateController = null;
let tray = null;
let lastOperation = null;
let smokePassedThisSession = false;
let quitting = false;
let shutdownInProgress = false;
let exitCommitted = false;
let cdpPort = 0;

function send(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel, value);
}
function publishOperation(operation) { lastOperation = operation; send("launcher:operation", operation); }
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address && typeof address === "object" ? address.port : 0));
    });
  });
}
function rendererNavigationAllowed(value) {
  try {
    const target = new URL(value);
    if (isDev) return target.origin === new URL(process.env.VITE_DEV_SERVER_URL).origin;
    target.hash = ""; target.search = "";
    return target.href === PACKAGED_RENDERER_URL;
  } catch { return false; }
}
async function openWebUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Only HTTPS external URLs are allowed");
  await shell.openExternal(url.toString());
}
function windowStateSnapshot(window) { return { fullScreen: Boolean(window && !window.isDestroyed() && window.isFullScreen()), maximized: Boolean(window && !window.isDestroyed() && window.isMaximized()) }; }
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}

function createWindow({ logger, stateStore, startHidden }) {
  const isMac = process.platform === "darwin";
  const saved = readWindowState(path.join(app.getPath("userData"), "window-state.json"), screen.getAllDisplays());
  const window = new BrowserWindow({
    width: saved.bounds.width,
    height: saved.bounds.height,
    ...(Number.isFinite(saved.bounds.x) && Number.isFinite(saved.bounds.y) ? { x: saved.bounds.x, y: saved.bounds.y } : {}),
    minWidth: MIN_WINDOW_BOUNDS.width,
    minHeight: MIN_WINDOW_BOUNDS.height,
    title: "CodexWeb Council",
    icon: APP_ICON_PATH,
    show: false,
    backgroundColor: isMac ? "#00000000" : "#181818",
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    transparent: isMac,
    ...(isMac ? { trafficLightPosition: { x: 16, y: 17 }, vibrancy: "under-window", visualEffectState: "active" } : { titleBarOverlay: { color: "#181818", symbolColor: "#a8a8a8", height: 46 } }),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, v8CacheOptions: "bypassHeatCheckAndEagerCompile" },
  });
  window.setMenuBarVisibility(false);
  const guard = (event, url) => { if (!rendererNavigationAllowed(url)) { event.preventDefault(); logger.warn("launcher.renderer_navigation_blocked", {}); } };
  window.webContents.on("will-navigate", guard);
  window.webContents.on("will-redirect", guard);
  window.webContents.setWindowOpenHandler(({ url }) => { void openWebUrl(url).catch(() => {}); return { action: "deny" }; });
  window.on("close", event => {
    if (quitting) return;
    event.preventDefault();
    if (stateStore.read().keepRunningOnClose && tray) window.hide(); else void requestQuit();
  });
  window.once("ready-to-show", () => {
    if (saved.maximized) window.maximize();
    if (saved.fullscreen) window.setFullScreen(true);
    if (!startHidden) window.show();
  });
  trackWindowState(window, path.join(app.getPath("userData"), "window-state.json"), error => logger.warn("launcher.window_state_write_failed", { message: error instanceof Error ? error.message : String(error) }));
  return window;
}

function createTray(logger) {
  try {
    const image = nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 18, height: 18 });
    tray = new Tray(image);
    tray.setToolTip("CodexWeb Council");
    tray.setContextMenu(Menu.buildFromTemplate([{ label: "Open CodexWeb Council", click: showMainWindow }, { type: "separator" }, { label: "Quit", click: () => void requestQuit() }]));
    tray.on("click", showMainWindow);
    return true;
  } catch (error) {
    logger.warn("launcher.tray_unavailable", { message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

async function loadRenderer(window) {
  if (isDev) await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}
function validateBounds(value) {
  if (!value || typeof value !== "object") throw new Error("Browser bounds are required");
  for (const key of ["x", "y", "width", "height"]) if (!Number.isFinite(value[key])) throw new Error(`Browser bounds ${key} must be finite`);
  return value;
}
function smokePassedForCurrentVersion(state) { return state.browserSmokePassed === true && state.browserSmokeVersion === app.getVersion(); }
function capabilityState(available) {
  return available
    ? { available: true, state: "ready" }
    : { available: false, state: "error", reason: { code: "CAPABILITY_UNAVAILABLE", retryable: true } };
}
function councilCapabilities(stateStore) {
  const state = stateStore.read();
  const tunnelReady = state.mcpRuntimeInstalled === true && state.mcpSetupComplete === true;
  return {
    secureTunnel: capabilityState(tunnelReady),
    localRepo: capabilityState(false),
    githubConnector: capabilityState(false),
    fullMcp: capabilityState(tunnelReady),
    wakeEngine: capabilityState(tunnelReady),
  };
}
function councilRuntimeSnapshot() {
  return councilConnectionSupervisor?.snapshot() ?? {
    controlPlane: { state: "connecting" },
    projection: { syncState: "idle" },
    managedProject: { state: "unattached", reason: { code: "PROJECT_UNATTACHED", retryable: false } },
    capabilities: {
      secureTunnel: capabilityState(false), localRepo: capabilityState(false), githubConnector: capabilityState(false), fullMcp: capabilityState(false), wakeEngine: capabilityState(false),
    },
  };
}

function registerIpc({ logger, stateStore }) {
  const handle = (channel, handler) => registerLoggedIpc(ipcMain, logger, channel, handler);
  handle("launcher:snapshot", async () => ({
    state: stateStore.read(), browser: browserHost?.snapshot() ?? null, councilRuntime: councilRuntimeSnapshot(), connectorName: COUNCIL_CONNECTOR_NAME,
    mcpCredentialsConfigured: runtimeHost?.mcpCredentialsConfigured() ?? false, logs: logger.recent(),
    urls: { github: GITHUB_URL, x: GITHUB_URL, connectors: CONNECTORS_URL, tunnels: TUNNELS_URL, keys: KEYS_URL },
    platform: process.platform, packaged: app.isPackaged, version: app.getVersion(),
    smokePassed: smokePassedThisSession || smokePassedForCurrentVersion(stateStore.read()), operation: lastOperation,
    update: updateController?.getState() ?? { status: "disabled" },
  }));
  handle("launcher:council-runtime-snapshot", () => councilRuntimeSnapshot());
  handle("launcher:set-language", (_event, language) => stateStore.update({ language: language === "zh-CN" ? "zh-CN" : "en" }));
  handle("launcher:open-social", async (_event, target) => { if (target !== "github" && target !== "x") throw new Error("Unknown social target"); await openWebUrl(GITHUB_URL); return stateStore.update(target === "github" ? { githubOpened: true } : { xOpened: true }); });
  handle("launcher:complete-onboarding", (_event, language) => stateStore.update({ language: language === "zh-CN" ? "zh-CN" : "en", onboardingComplete: true, githubOpened: true, xOpened: true }));
  handle("launcher:open-external", async (_event, url) => { if (!ALLOWED_EXTERNAL_URLS.has(url)) throw new Error("External URL is not allowlisted"); await openWebUrl(url); return true; });
  handle("launcher:browser-bounds", (_event, bounds) => { browserHost.setBounds(validateBounds(bounds)); return true; });
  handle("launcher:browser-surface-active", (_event, active) => browserHost.setSurfaceActive(active === true));
  handle("launcher:browser-show", () => browserHost.reveal());
  handle("launcher:browser-hide", () => { browserHost.hide(); return browserHost.snapshot(); });
  handle("launcher:browser-navigate", (_event, action) => browserHost.navigate(action));
  handle("launcher:browser-zoom", (_event, action) => browserHost.zoom(action));
  handle("launcher:browser-tab-select", (_event, tabId) => browserHost.selectTab(tabId));
  handle("launcher:browser-tab-close", (_event, tabId) => browserHost.closeTab(tabId));
  handle("launcher:browser-login", async () => { const browser = await browserHost.openLogin(); if (browser.authenticated) send("launcher:state-changed", stateStore.update({ sessionRefreshReminderAt: nextSessionRefreshReminderAt() })); return browser; });
  handle("launcher:browser-logout", async () => { const browser = await browserHost.logout(); const state = stateStore.update({ sessionRefreshReminderAt: nextSessionRefreshReminderAt() }); send("launcher:state-changed", state); return { browser, state }; });
  handle("launcher:session-reminder-dismiss", () => { const state = stateStore.update({ sessionRefreshReminderAt: nextSessionRefreshReminderAt() }); send("launcher:state-changed", state); return state; });
  handle("launcher:browser-smoke", async () => { const result = await browserHost.smokeTest(); smokePassedThisSession = true; stateStore.update({ browserSmokePassed: true, browserSmokeVersion: app.getVersion() }); return result; });
  handle("launcher:setup-mcp", async (_event, input = {}) => {
    const result = await runtimeHost.setupCouncilMcp({ tunnelId: typeof input.tunnelId === "string" ? input.tunnelId.trim() : "", runtimeKey: typeof input.runtimeKey === "string" ? input.runtimeKey : "", replace: input.replace === true });
    const state = stateStore.update({ mcpRuntimeInstalled: true, mcpSetupComplete: false, mcpGuideStep: 2 }); send("launcher:state-changed", state);
    return { ok: true, stdout: result.stdout };
  });
  handle("launcher:mcp-verify", async () => {
    const report = await runtimeHost.doctor();
    if (!report.ok) { const state = stateStore.update({ mcpSetupComplete: false }); send("launcher:state-changed", state); return report; }
    await browserHost.verifyConnector(COUNCIL_CONNECTOR_NAME);
    const state = stateStore.update({ mcpSetupComplete: true }); send("launcher:state-changed", state); return report;
  });
  handle("launcher:doctor", () => runtimeHost.doctor());
  handle("launcher:cancel-turns", async () => ({ stdout: "Council browser turns are managed by the Agent Manager" }));
  handle("launcher:council-bind-current-lead", async (_event, input = {}) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Council lead binding input is invalid");
    const unexpected = Object.keys(input).filter(key => key !== "projectName");
    if (unexpected.length) throw new Error(`Council lead binding rejects renderer-controlled fields: ${unexpected.join(", ")}`);
    if (browserHost.snapshot().authenticated !== true) throw new Error("Sign in to ChatGPT before binding a Council Lead");
    const conversationUrl = browserHost.currentHomeConversationUrl();
    const projectName = typeof input.projectName === "string" ? input.projectName.trim().slice(0, 160) : "ChatGPT Project";
    return await bindCurrentConversationAsLead({ conversationUrl, projectName: projectName || "ChatGPT Project" });
  });
  handle("launcher:set-mcp-step", (_event, step) => { if (!Number.isInteger(step) || step < 0 || step > 2) throw new Error("Invalid MCP guide step"); return stateStore.update({ mcpGuideStep: step }); });
  handle("launcher:autostart", (_event, enabled) => { const desired = enabled === true; const autostart = setAutostart(app, desired); return { state: stateStore.update({ autoStart: desired }), ...autostart }; });
  handle("launcher:set-preference", (_event, key, value) => { if (key !== "keepRunningOnClose" && key !== "showBrowserDuringTurns") throw new Error("Unknown preference"); return stateStore.update({ [key]: value === true }); });
  handle("launcher:sidebar-state", (_event, value) => stateStore.update(validateSidebarState(value)));
  handle("launcher:logs", (_event, limit) => logger.recent(limit));
  handle("launcher:open-logs", async () => { const error = await shell.openPath(path.dirname(logger.filePath)); if (error) throw new Error(error); return logger.filePath; });
  handle("launcher:update-install", async () => { if (!updateController) throw new Error("Council updates are unavailable"); const launch = await updateController.beginInstall(); const result = await requestQuit(); if (!result.ok) { updateController.cancelInstall(launch); throw new Error(result.message); } return true; });
  handle("launcher:window-state", event => windowStateSnapshot(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.on("launcher:window-control", (event, action) => { const window = BrowserWindow.fromWebContents(event.sender); if (!window || window.isDestroyed()) return; if (action === "close") window.close(); else if (action === "minimize") window.minimize(); else if (action === "zoom") window.isMaximized() ? window.unmaximize() : window.maximize(); });
}

async function requestQuit() {
  if (shutdownInProgress || exitCommitted) return { ok: false, message: "Council shutdown is already in progress" };
  shutdownInProgress = true;
  try {
    const active = runtimeHost?.currentOperation() || browserHost?.currentOperation();
    if (active) throw new Error(`Wait for ${active} to finish before quitting CodexWeb Council`);
    await councilConnectionSupervisor?.stop();
    await runtimeSupervisor?.shutdown();
    quitting = true;
    await browserHost?.persistSession();
    browserHost?.destroy();
    await browserControl?.close();
    exitCommitted = true;
    app.quit();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error); quitting = false; showMainWindow(); publishOperation({ name: "launcher-quit", status: "failed", message }); return { ok: false, message };
  } finally { shutdownInProgress = false; }
}

async function start() {
  cdpPort = await findFreePort();
  if (process.platform === "linux") app.commandLine.appendSwitch("class", "codexweb-council");
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", String(cdpPort));
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on("second-instance", showMainWindow);
  await app.whenReady();

  let installedRuntimeRoot = null;
  let runtimeRootResolved = false;
  const runtimeRootProvider = () => {
    if (!runtimeRootResolved || (app.isPackaged && (!installedRuntimeRoot || !fs.existsSync(installedRuntimeRoot)))) {
      installedRuntimeRoot = ensurePackagedRuntime({ app, coreHome: CORE_HOME, resourcesPath: process.resourcesPath });
      runtimeRootResolved = true;
    }
    return installedRuntimeRoot;
  };
  const stateStore = createStateStore(path.join(app.getPath("userData"), "launcher-state.json"));
  if (stateStore.read().sessionRefreshReminderAt === null) stateStore.update({ sessionRefreshReminderAt: nextSessionRefreshReminderAt() });
  const autostart = getAutostart(app); if (autostart.supported && stateStore.read().autoStart !== autostart.enabled) setAutostart(app, stateStore.read().autoStart);
  const logger = createLogger({ filePath: path.join(app.getPath("logs"), "launcher.jsonl"), publish: record => send("launcher:log", record) });
  const startHidden = process.argv.includes("--hidden") && stateStore.read().onboardingComplete;
  nativeTheme.themeSource = "system";
  mainWindow = createWindow({ logger, stateStore, startHidden });
  browserControl = await new BrowserControlServer({ logger, getBrowserHost: () => browserHost, getPreferences: () => stateStore.read() }).start();
  runtimeSupervisor = new RuntimeSupervisor({ app, logger, sourceRoot: SOURCE_ROOT, installedRuntimeRoot, runtimeRootProvider, coreHome: CORE_HOME, browserDescriptorPath: BROWSER_DESCRIPTOR_PATH, publishOperation });
  runtimeHost = new RuntimeHost({ app, logger, sourceRoot: SOURCE_ROOT, installedRuntimeRoot, runtimeRootProvider, browserDescriptorPath: BROWSER_DESCRIPTOR_PATH, publishOperation, supervisor: runtimeSupervisor });
  councilConnectionSupervisor = new CouncilConnectionSupervisor({ logger, capabilities: () => councilCapabilities(stateStore), publish: state => send("launcher:council-runtime", state) });
  browserHost = new BrowserHost({ window: mainWindow, descriptorPath: BROWSER_DESCRIPTOR_PATH, cdpPort, control: browserControl.descriptor(), getConnectorName: () => COUNCIL_CONNECTOR_NAME, helper: { executable: process.execPath, script: BROWSER_HELPER_PATH }, logger, publishState: state => send("launcher:browser-state", state) });
  await browserHost.ready();
  const updaterRuntimeRoot = runtimeRootProvider();
  updateController = createUpdateController({ currentVersion: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, executablePath: process.execPath, runtimeExecutable: updaterRuntimeRoot ? runtimeBundlePaths(updaterRuntimeRoot, process.platform).executable : null, logsDirectory: app.getPath("logs"), publish: state => send("launcher:update-state", state), logger });
  registerIpc({ logger, stateStore });
  councilConnectionSupervisor.start();
  const trayAvailable = createTray(logger); if (startHidden && !trayAvailable) mainWindow.once("ready-to-show", showMainWindow);

  const smoke = process.argv.includes("--launcher-smoke-test");
  await loadRenderer(mainWindow);
  if (smoke) {
    const smokeRuntimeRoot = runtimeRootProvider();
    if (app.isPackaged && !smokeRuntimeRoot) throw new Error("Packaged Council smoke test could not install its durable runtime");
    const invocation = runtimeSupervisor.runtimeCommand(["--version"]);
    const result = spawnSync(invocation.executable, invocation.args, { cwd: invocation.cwd, encoding: "utf8", timeout: 30_000, windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0 || result.stdout.trim() !== app.getVersion()) throw new Error(`Installed Council runtime is not executable (status=${result.status ?? "unknown"})`);
    const markerPath = process.env.CODEX_WEB_GPT_SMOKE_FILE?.trim();
    if (!markerPath || !path.isAbsolute(markerPath)) throw new Error("Packaged Council smoke test requires an absolute CODEX_WEB_GPT_SMOKE_FILE");
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, `${JSON.stringify({ ok: true, product: "codexweb-council", version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, runtimeVerified: true })}\n`);
    await councilConnectionSupervisor.stop(); browserHost.destroy(); await browserControl.close(); mainWindow.destroy(); app.quit(); return;
  }

  void browserHost.refreshAuthentication().catch(error => logger.warn("browser.session_refresh_failed", { message: error instanceof Error ? error.message : String(error) }));
  void updateController.checkOnce();
  void (async () => {
    const upgrade = await runtimeHost.upgradeManagedRuntime();
    if (upgrade.updated) logger.info("council.runtime_upgraded", { fromVersion: upgrade.fromVersion, toVersion: upgrade.toVersion });
    const runtime = await runtimeSupervisor.startIfConfigured();
    if (runtime.status === "ready") {
      const state = stateStore.update({ mcpRuntimeInstalled: true }); send("launcher:state-changed", state);
    } else if (runtime.status === "not-configured") {
      const state = stateStore.update({ mcpRuntimeInstalled: false, mcpSetupComplete: false }); send("launcher:state-changed", state);
    } else if (runtime.status !== "needs-setup") {
      publishOperation({ name: "runtime-start", status: "failed", message: runtime.detail || `Council runtime is ${runtime.status}` });
    }
  })().catch(error => { const message = error instanceof Error ? error.message : String(error); logger.error("council.runtime_start_failed", { message }); publishOperation({ name: "runtime-start", status: "failed", message }); });

  app.on("activate", showMainWindow);
  app.on("before-quit", event => { if (exitCommitted) return; event.preventDefault(); void requestQuit(); });
  process.once("SIGINT", () => void requestQuit());
  process.once("SIGTERM", () => void requestQuit());
}

void start().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  try { fs.appendFileSync(path.join(app.getPath("logs"), "launcher-fatal.log"), `${new Date().toISOString()} ${error?.stack || error}\n`); } catch {}
  try { dialog.showErrorBox("CodexWeb Council could not start", message); } catch {}
  app.exit(1);
});
