const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const testsDir = path.join(root, "tests");
const retiredCodexContracts = new Set([
  "renderer-wiring.test.cjs",
  "runtime-host.test.cjs",
]);
const files = fs.readdirSync(testsDir)
  .filter(name => name.endsWith(".test.cjs") && !retiredCodexContracts.has(name))
  .sort()
  .map(name => path.join("tests", name));

if (files.length === 0) throw new Error("No active Council launcher tests were discovered");
const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
