const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const main = readFileSync(join(root, "src", "main.tsx"), "utf8");
const dock = readFileSync(join(root, "src", "CouncilDock.tsx"), "utf8");
const setup = readFileSync(join(root, "src", "CouncilSetupPanel.tsx"), "utf8");
const agents = readFileSync(join(root, "src", "CouncilAgentsPanel.tsx"), "utf8");
const updates = readFileSync(join(root, "src", "CouncilUpdatePrompt.tsx"), "utf8");
const types = readFileSync(join(root, "src", "types.ts"), "utf8");
const preload = readFileSync(join(root, "electron", "preload.cjs"), "utf8");
const css = readFileSync(join(root, "src", "council.css"), "utf8");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");

test("Council UI is additive and preserves the existing App", () => {
  assert.match(main, /import \{ App \} from "\.\/App"/);
  assert.match(main, /<App\s*\/>/);
  assert.match(main, /<CouncilDock\s*\/>/);
  assert.match(main, /<CouncilAgentsPanel\s*\/>/);
  assert.match(main, /<CouncilSetupPanel\s*\/>/);
  assert.match(main, /<CouncilUpdatePrompt\s*\/>/);
  assert.match(main, /import "\.\/styles\.css"/);
});

test("Council renderer consumes main-process shared projection instead of treating local runtime as Council truth", () => {
  assert.doesNotMatch(dock, /http:\/\/127\.0\.0\.1:17842\/api\/state/);
  assert.doesNotMatch(agents, /http:\/\/127\.0\.0\.1:17842\/api\/state/);
  assert.doesNotMatch(dock, /const \[online,\s*setOnline\]/);
  assert.match(dock, /onCouncilRuntime/);
  assert.match(dock, /syncState/);
  assert.match(preload, /onCouncilRuntime/);
  assert.match(types, /CouncilRuntimeViewState/);
  assert.match(types, /councilRuntime/);
  assert.match(types, /onCouncilRuntime/);
  assert.doesNotMatch(dock, /https:\/\//);
  assert.doesNotMatch(agents, /https:\/\//);
  assert.match(setup, /api\.setupMcp/);
  assert.match(setup, /CodexWeb Council/);
});

test("Council shared visibility distinguishes live, stale and sync-error state from execution capabilities", () => {
  assert.match(dock, /syncState\s*===\s*["']live["']/);
  assert.match(dock, /syncState\s*===\s*["']stale["']/);
  assert.match(dock, /syncState\s*===\s*["']error["']/);
  assert.match(dock, /managedProject/);
  assert.match(dock, /capabilities/);
  assert.match(dock, /lastSyncedAt/);
  assert.doesNotMatch(dock, /!online\s*&&\s*<EmptyState title=["']Council runtime is offline/);
});

test("Council wake cards expose canonical transition evidence", () => {
  assert.match(dock, /wake\.transitions/);
  assert.match(dock, /council-wake-timeline/);
  assert.match(css, /\.council-wake-timeline/);
});

test("managed agents can select only the controller-provided agent tab", () => {
  assert.match(agents, /tab\.agentId/);
  assert.match(agents, /selectBrowserTab\(tab\.id\)/);
  assert.doesNotMatch(agents, /conversationUrl/);
  assert.doesNotMatch(agents, /checkpoint\b/);
});

test("update notification requires explicit user choice", () => {
  assert.match(updates, /Update now/);
  assert.match(updates, /Later/);
  assert.match(updates, /Skip this version/);
  assert.match(updates, /api\.installUpdate/);
  assert.doesNotMatch(updates, /installUpdate\(\).*useEffect/);
});

test("Council overlay hides and restores the external ChatGPT browser surface", () => {
  assert.match(dock, /setBrowserSurfaceActive\(false\)/);
  assert.match(dock, /setBrowserSurfaceActive\(true\)/);
  assert.match(dock, /restoreBrowser\.current/);
});

test("Council UI keeps the existing visual token system", () => {
  assert.match(css, /var\(--color-background-surface\)/);
  assert.match(css, /var\(--color-border\)/);
  assert.match(css, /var\(--font-ui\)/);
  assert.match(css, /var\(--radius-round\)/);
});
