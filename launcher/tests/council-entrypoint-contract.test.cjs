const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("Electron starts from the standalone Council main without loading the retired Codex launcher", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.main, "electron/main-council.cjs");
  const entry = fs.readFileSync(path.join(root, "electron", "main-council.cjs"), "utf8");
  assert.match(entry, /CODEXWEB_COUNCIL_PRODUCT = "1"/);
  assert.match(entry, /createCouncilBrowserHostClass/);
  assert.match(entry, /createCouncilBrowserControlServerClass/);
  assert.match(entry, /setupCouncilMcp/);
  assert.match(entry, /launcher:council-bind-current-lead/);
  assert.match(entry, /COUNCIL_CONNECTOR_NAME/);
  assert.doesNotMatch(entry, /require\("\.\/main\.cjs"\)/);
  assert.doesNotMatch(entry, /setupCore/);
  assert.doesNotMatch(entry, /setBridgeEnabled/);
  assert.doesNotMatch(entry, /codexCatalogVerified/);
});
