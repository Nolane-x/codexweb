# Council 4.0 Foundation verification

Verified locally in the provided source snapshot on 2026-08-31 before opening the draft PR.

## Evidence

- Focused Council 4.0 regression suite: **12/12 passed**.
- Launcher active suite: **152 passed, 1 failed**.
- The sole launcher failure is environmental in this sandbox: `tests/browser-host.test.cjs` cannot load the `electron` package because the uploaded source ZIP does not contain installed dependencies.
- The previously observed Mission Control presence-style regression was reproduced by `launcher/tests/council-presence-ui.test.cjs`, fixed by restoring the `council-presence.css` import, and then re-run **4/4 passed**.

## CI gate

The draft PR is intentionally not considered merge-ready until GitHub Actions runs the repository's Bun, Electron packaging, smoke, and cross-platform checks on macOS, Ubuntu, and Windows.

## Scope in this branch

- trusted parked/sleeping agent conversation focus without leaking conversation URLs to the renderer;
- optional MCP connector with browser-only Council fallback;
- layered Connection Truth Model and Mission Control IA;
- ChatGPT Deep State Engine and Playwright integration;
- MCP Control Plane v2 capabilities/status/diagnostics plus focused read model;
- DecisionGate v2 independent-critique enforcement.
