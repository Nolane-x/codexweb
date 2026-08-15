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

test("sandbox preload keeps owner-control secrets behind main-process IPC", () => {
  const preload = read("electron/preload.cjs");
  assert.doesNotMatch(preload, /require\(["']\.\/council-owner-client\.cjs["']\)/);
  assert.doesNotMatch(preload, /owner-control\.json/);
  assert.match(preload, /ipcRenderer\.invoke\("launcher:council-supervisor-status"\)/);
});
