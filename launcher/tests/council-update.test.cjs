const test = require("node:test");
const assert = require("node:assert/strict");
const update = require("../electron/council-update.cjs");

test("Council updater is pinned to Nolane-x/codexweb", () => {
  assert.equal(update.REPOSITORY, "Nolane-x/codexweb");
  const url = `https://github.com/Nolane-x/codexweb/releases/download/v3.0.0/codex-web-gpt-3.0.0-win-x64.exe`;
  assert.equal(update.validateReleaseAssetUrl(url, "3.0.0", "codex-web-gpt-3.0.0-win-x64.exe"), url);
  assert.throws(() => update.validateReleaseAssetUrl("https://github.com/miuuyy/codex-chatgpt-web/releases/download/v3.0.0/codex-web-gpt-3.0.0-win-x64.exe", "3.0.0", "codex-web-gpt-3.0.0-win-x64.exe"), /unexpected/);
});

test("Council updater keeps stable semver and platform artifact names", () => {
  assert.equal(update.compareVersions("3.0.0", "2.9.9"), 1);
  assert.equal(update.releaseAssetName("3.0.0", "win32", "x64"), "codex-web-gpt-3.0.0-win-x64.exe");
  assert.equal(update.releaseAssetName("3.0.0", "darwin", "arm64"), "codex-web-gpt-3.0.0-mac-arm64.zip");
});
