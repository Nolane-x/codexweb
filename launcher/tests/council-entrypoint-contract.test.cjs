const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("Electron starts through additive Council wrapper while preserving legacy main", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.main, "electron/main-council.cjs");
  const wrapper = fs.readFileSync(path.join(root, "electron", "main-council.cjs"), "utf8");
  assert.match(wrapper, /browser-host\.cjs/);
  assert.match(wrapper, /control-server\.cjs/);
  assert.match(wrapper, /runtime\.cjs/);
  assert.match(wrapper, /setupCouncilMcp/);
  assert.match(wrapper, /runtimeModule\.RuntimeHost = CouncilRuntimeHost/);
  assert.match(wrapper, /require\("\.\/main\.cjs"\)/);
  assert.equal(fs.existsSync(path.join(root, "electron", "main.cjs")), true);
});
