const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const launcherRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(launcherRoot, "..");
const launcherPackage = JSON.parse(fs.readFileSync(path.join(launcherRoot, "package.json"), "utf8"));
const rootPackage = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
const installerSh = fs.readFileSync(path.join(repositoryRoot, "scripts", "install-launcher.sh"), "utf8");
const installerPs1 = fs.readFileSync(path.join(repositoryRoot, "scripts", "install-launcher.ps1"), "utf8");
const update = fs.readFileSync(path.join(launcherRoot, "electron", "update.cjs"), "utf8");
const updateWorker = fs.readFileSync(path.join(launcherRoot, "electron", "update-worker.cjs"), "utf8");
const renderer = fs.readFileSync(path.join(launcherRoot, "src", "App.tsx"), "utf8");
const browserSurface = fs.readFileSync(path.join(launcherRoot, "src", "BrowserSurface.tsx"), "utf8");
const main = fs.readFileSync(path.join(launcherRoot, "electron", "main.cjs"), "utf8");

test("the public launcher command uses the Electron bootstrap", () => {
  const starter = fs.readFileSync(path.join(repositoryRoot, "scripts", "start-launcher.ts"), "utf8");
  assert.match(starter, /launcherPackage/);
  assert.match(starter, /electron/);
});

test("launcher publishes native packages for all supported desktop operating systems", () => {
  assert.equal(launcherPackage.version, rootPackage.version);
  assert.equal(launcherPackage.build.productName, "Codex Web GPT");
  assert.match(launcherPackage.build.artifactName, /\$\{version\}/);
  assert.match(launcherPackage.build.artifactName, /\$\{os\}/);
  assert.match(launcherPackage.build.artifactName, /\$\{arch\}/);
  assert.ok(launcherPackage.build.mac.target.includes("dmg"));
  assert.ok(launcherPackage.build.mac.target.includes("zip"));
  assert.ok(launcherPackage.build.win.target.includes("nsis"));
  assert.ok(launcherPackage.build.linux.target.includes("AppImage"));
});

test("release installers resolve checksummed native launcher assets", () => {
  assert.match(installerSh, /checksums\.txt/);
  assert.match(installerSh, /codex-web-gpt-\$VERSION-\$PLATFORM-\$ARCH\.\$EXTENSION/);
  assert.match(installerSh, /AppImage/);
  assert.match(installerSh, /Codex Web GPT\.app/);
  assert.match(installerPs1, /checksums\.txt/);
  assert.match(installerPs1, /codex-web-gpt-\$Version-win-\$Arch\.exe/);
});

test("packaged launcher owns a detached checksummed updater for every release platform", () => {
  assert.match(update, /checksums\.txt/);
  assert.match(update, /createHash\("sha256"\)/);
  assert.match(update, /update-worker\.cjs/);
  assert.match(update, /detached: true/);
  assert.match(updateWorker, /darwin/);
  assert.match(updateWorker, /win32/);
  assert.match(updateWorker, /linux/);
});

test("CI packages and smoke-launches on macOS, Windows, and Linux", () => {
  const ci = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  const release = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "release.yml"), "utf8");
  assert.match(ci, /macos-15, ubuntu-latest, windows-latest/);
  assert.match(ci, /bun run app:package/);
  assert.match(ci, /bun run app:smoke/);
  assert.match(ci, /prepare-windows-baseline-bun\.ps1 -Version 1\.3\.14/);
  for (const runner of ["macos-15", "macos-15-intel", "ubuntu-latest", "windows-latest"]) {
    assert.match(release, new RegExp(runner));
  }
  assert.match(release, /launcher\/build\/runtime/);
  assert.match(release, /bun run app:smoke/);
  assert.match(release, /prepare-windows-baseline-bun\.ps1 -Version 1\.3\.14/);
  assert.match(release, /codesign --verify --deep --strict --verbose=2/);
  assert.match(release, /Codex Web GPT\.app/);
  assert.doesNotMatch(release, /gh release create[\s\S]*?--draft/);
});

test("release publishes the repository demo as a checksummed versioned asset", () => {
  const release = fs.readFileSync(path.join(repositoryRoot, ".github", "workflows", "release.yml"), "utf8");
  const demo = fs.readFileSync(path.join(repositoryRoot, "assets", "demo.gif"));
  const demoCopy = 'cp assets/demo.gif "release-assets/codex-web-gpt-${RELEASE_VERSION}-demo.gif"';
  const checksumStep = release.indexOf("- name: Create checksums");
  assert.equal(demo.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.ok(release.includes(demoCopy));
  assert.ok(
    release.indexOf(demoCopy) < checksumStep,
    "the versioned demo must enter release-assets before checksums are generated",
  );
  assert.match(release.slice(checksumStep), /find \. -maxdepth 1 -type f ! -name checksums\.txt/);
});

test("Windows packages embed the checksummed Bun baseline runtime for CPUs without AVX2", () => {
  const builder = fs.readFileSync(path.join(repositoryRoot, "scripts", "build-runtime-bundle.ts"), "utf8");
  const baseline = fs.readFileSync(
    path.join(repositoryRoot, "scripts", "prepare-windows-baseline-bun.ps1"),
    "utf8",
  );
  assert.match(builder, /CODEX_CHATGPT_WEB_PACKAGED_BUN/);
  assert.match(baseline, /bun-windows-x64-baseline/);
  assert.match(baseline, /Get-FileHash -Algorithm SHA256/);
  assert.match(baseline, /checksums\.txt/);
  assert.match(baseline, /CODEX_CHATGPT_WEB_PACKAGED_BUN/);
});

test("embedded ChatGPT is measured only after its animated surface mounts", () => {
  const browserSurfaceIndex = renderer.indexOf("<BrowserSurface");
  const browserBoundsIndex = renderer.indexOf("setBrowserBounds");
  assert.ok(browserSurfaceIndex >= 0);
  assert.ok(browserBoundsIndex < 0, "App must not measure an unmounted browser surface");
  assert.match(browserSurface, /ResizeObserver/);
  assert.match(browserSurface, /setBrowserBounds/);
});

test("closing the launcher follows the persisted background-runtime preference", () => {
  assert.match(main, /keepRunningOnClose/);
  assert.match(main, /requestQuit/);
});

test("normal shutdown persists the ChatGPT session before closing browser views", () => {
  const persistIndex = main.indexOf("browserHost?.persistSession?.()");
  const disposeIndex = main.indexOf("browserHost?.dispose?.()");
  assert.ok(persistIndex >= 0);
  assert.ok(disposeIndex >= 0);
  assert.ok(persistIndex < disposeIndex);
});
