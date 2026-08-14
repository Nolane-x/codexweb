import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(import.meta.dir, "..", path), "utf8");
}

test("Council setup never reads or mutates Codex integration state", () => {
  const setup = source("src/council/setup.ts");
  expect(setup).not.toContain("codex-route-removal");
  expect(setup).not.toContain("removeManagedCodexRoute");
  expect(setup).not.toContain("codexIntegrationRemoved");
});

test("Council Electron entrypoint declares standalone product mode", () => {
  const entry = source("launcher/electron/main-council.cjs");
  expect(entry).toContain("CODEXWEB_COUNCIL_PRODUCT");
});

test("Plus fallback is wired through preload and Agents UI", () => {
  const preload = source("launcher/electron/preload.cjs");
  const agents = source("launcher/src/CouncilAgentsPanel.tsx");
  expect(preload).toContain("bindCurrentChatGptAsLead");
  expect(agents).toContain("Bind current ChatGPT as Lead");
});

test("Council launcher UI no longer requires Codex catalog installation", () => {
  const app = source("launcher/src/App.tsx");
  expect(app).not.toContain("api!.setupCore()");
  expect(app).not.toContain("snapshot.state.codexCatalogVerified");
  expect(app).not.toContain("snapshot.state.codexRestartRequired");
});
