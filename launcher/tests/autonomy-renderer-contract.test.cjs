const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("Council workspace renders durable autonomy state from the safe shared projection", () => {
  const app = read("src/CouncilApp.tsx");
  const types = read("src/types.ts");
  assert.match(app, /managed\?\.autonomy/);
  assert.match(app, /breakerOpenCount/);
  assert.match(app, /dispatcher\.uncertain/);
  assert.match(app, /healthByAgent/);
  assert.match(types, /CouncilAutonomyStatusView/);
  assert.match(types, /autonomy\?: CouncilAutonomyStatusView \| null/);
});

test("Council 3.6 exposes human-only exceptional work recovery and safe memory pages", () => {
  const app = read("src/CouncilApp.tsx");
  const preload = read("electron/preload.cjs");
  const main = read("electron/main-council.cjs");
  assert.match(app, /AutonomyPanel/);
  assert.match(app, /MemoryPanel/);
  assert.match(app, /Create explicit retry intent/);
  assert.match(app, /provenance/);
  for (const channel of [
    "launcher:council-autonomy-status",
    "launcher:council-autonomy-exceptional",
    "launcher:council-autonomy-cancel",
    "launcher:council-autonomy-retry-uncertain",
    "launcher:council-memory-search",
    "launcher:council-memory-recent",
  ]) {
    assert.match(preload, new RegExp(channel.replaceAll("-", "\\-")));
    assert.match(main, new RegExp(channel.replaceAll("-", "\\-")));
  }
});

test("sandbox preload keeps owner-control secrets behind main-process IPC", () => {
  const preload = read("electron/preload.cjs");
  assert.doesNotMatch(preload, /require\(["']\.\/council-owner-client\.cjs["']\)/);
  assert.doesNotMatch(preload, /owner-control\.json/);
  assert.doesNotMatch(preload, /Bearer /);
  assert.match(preload, /ipcRenderer\.invoke\("launcher:council-supervisor-status"\)/);
});
