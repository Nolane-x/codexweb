const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const launcherRoot = join(__dirname, "..");
const launcherPackage = JSON.parse(readFileSync(join(launcherRoot, "package.json"), "utf8"));
const mainSource = readFileSync(join(launcherRoot, "electron", "main-council.cjs"), "utf8");

test("Linux desktop entry and Electron WM_CLASS stay associated", () => {
  assert.equal(typeof launcherPackage.desktopName, "string", "launcher package must declare desktopName");
  assert.match(launcherPackage.desktopName, /^[A-Za-z0-9._-]+\.desktop$/);
  assert.equal(launcherPackage.build?.linux?.syncDesktopName, true, "electron-builder must sync the .desktop filename and StartupWMClass");

  const classSwitch = mainSource.match(/appendSwitch\(["']class["']\s*,\s*["']([^"']+)["']\)/);
  assert.ok(classSwitch, "Linux launcher must define its window class explicitly");
  assert.equal(classSwitch[1], launcherPackage.desktopName.replace(/\.desktop$/, ""));
});
