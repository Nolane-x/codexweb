# Council Supervisor Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a sequential, self-healing managed ChatGPT loop with real Council connector selection, user-selected manager observation every 20 minutes, screenshot-based health review, durable retry, project tabs, and deletable bounded history.

**Architecture:** Keep `CouncilStore` and managed-agent state authoritative. Add a private observation store and `CouncilSupervisor` in the local runtime, expose owner-only supervisor/history HTTP operations to Electron, extend managed Playwright transport for connector-backed turns plus read-only screenshot capture, and serialize all browser-affecting work. The launcher remains a projection/control UI and never owns private conversation URLs.

**Tech Stack:** Bun 1.3.14, TypeScript 5.9, Electron 41, Playwright 1.62, React 19, existing loopback owner-control HTTP and GitHub Actions.

## Global Constraints

- One browser-affecting managed operation at a time per scheduler lane; supervisor observation is sequential and non-overlapping.
- Supervisor interval defaults to exactly 20 minutes and stops immediately when manager selection is cleared.
- Conversation URLs, tokens and absolute archive paths remain private controller state.
- Managed prompt submission requires an exact selected `CodexWeb Council` connector marker.
- No automatic retry after prompt-submission evidence.
- Capacity/transient pre-submit failures queue/retry instead of terminally failing on the first attempt.
- Observation archive defaults to 72 runs and 512 MiB and may be deleted by the user.
- AI memory injection is compact, bounded and derived only from retained safe observation metadata/analysis.
- Existing Council public state schema remains backward compatible.

---

### Task 1: Private observation archive

**Files:**
- Create: `src/council/observation-store.ts`
- Create: `tests/council-observation-store.test.ts`

**Interfaces:**
- `CouncilObservationStore.list(): CouncilObservationSummary[]`
- `CouncilObservationStore.get(runId: string): CouncilObservationRecord | undefined`
- `CouncilObservationStore.begin(...)`, `complete(...)`, `fail(...)`
- `CouncilObservationStore.delete(runId: string): boolean`
- `CouncilObservationStore.clear(): number`
- `CouncilObservationStore.memoryDigest(limit?: number): string`

- [ ] Write archive load/append/delete/retention/corruption tests.
- [ ] Implement versioned metadata, private file permissions, PNG naming, bounded digest and oldest-first pruning.
- [ ] Run focused tests/typecheck.

### Task 2: Managed browser connector + read-only capture

**Files:**
- Modify: `src/council/browser-transport.ts`
- Modify: `src/council/playwright-council-driver.ts`
- Create/modify focused tests under `tests/council-browser-transport.test.ts` and `tests/council-supervisor-browser.test.ts`.

**Interfaces:**
- Driver managed `create`/`resume` explicitly selects exact `CodexWeb Council` before prompt insertion.
- `CouncilBrowserTransport.captureConversation({ agentId, conversationUrl }): Promise<{ png: Buffer; conversationUrl: string; health: ... }>`

- [ ] Add connector selection postcondition tests and read-only capture contract tests.
- [ ] Reuse exact connector semantics from the existing ChatGPT Web adapter without relying on synthetic click events.
- [ ] Add robust scroll-to-bottom settling and safe surface classification.
- [ ] Run focused tests/typecheck.

### Task 3: Durable single-concurrency managed work scheduling

**Files:**
- Create: `src/council/work-scheduler.ts`
- Modify: `src/council/agent-manager.ts`
- Modify: `src/council/agent-registry.ts` if wake-up notification is needed.
- Modify: `tests/council-agent-manager.test.ts`
- Create: `tests/council-work-scheduler.test.ts`

**Interfaces:**
- FIFO `enqueue(key, operation, retryPolicy)` with bounded pre-submit retry/backoff and cancellation.
- Spawn/wake no longer return permanently queued agents or convert temporary surface pressure into immediate failed wake.

- [ ] Add RED tests for queued spawn, queued wake, sequential wake effects and retry exhaustion.
- [ ] Implement scheduler and integrate manager operations.
- [ ] Run focused tests/typecheck.

### Task 4: Supervisor runtime

**Files:**
- Create: `src/council/supervisor.ts`
- Modify: `src/council/managed-runtime.ts`
- Modify: `src/council/mcp-main.ts`
- Create: `tests/council-supervisor.test.ts`

**Interfaces:**
- `setManager(agentId?: string)`; `status()`; `runNow()`; `history()`; `deleteObservation()`; `clearHistory()`.
- Exactly one timer, 20-minute cadence, no overlap.
- Capture agents sequentially, archive screenshots, then invoke manager once with attached images/manifest and bounded memory digest.
- Manager effects route through existing action parser/manager sequentially.

- [ ] Add fake-clock tests for start/stop/no-overlap/20-minute cadence.
- [ ] Add sequencing test proving capture A finishes before B starts and manager starts after all captures.
- [ ] Add failure classification/rate-limit cooldown tests.
- [ ] Implement runtime and wire it at MCP startup.

### Task 5: Owner-only local control API

**Files:**
- Modify: `src/council/http-server.ts`
- Modify: `src/council/owner-control.ts`
- Modify: `launcher/electron/council-owner-client.cjs`
- Modify/add security tests: `tests/council-owner-http-security.test.ts`, `launcher/tests/council-owner-client.test.cjs`.

**Interfaces:**
- Owner endpoints for supervisor status, manager selection, run-now, history list/read/delete/clear.
- Return opaque screenshot identifiers or safe data URLs through explicit read calls; never return local file paths.

- [ ] Add authentication/validation/path-traversal tests.
- [ ] Implement owner handlers and Electron client wrappers.

### Task 6: Launcher manager selection, project tab strip, history UI

**Files:**
- Modify: `launcher/electron/main-council.cjs`
- Modify: `launcher/electron/preload.cjs`
- Modify: `launcher/src/types.ts`
- Modify: `launcher/src/CouncilAgentsPanel.tsx`
- Create: `launcher/src/CouncilProjectTabs.tsx`
- Create: `launcher/src/CouncilSupervisorPanel.tsx`
- Modify: `launcher/src/CouncilApp.tsx`
- Modify: `launcher/src/council-agents.css`, `launcher/src/council-shell.css` or focused new CSS files.
- Add launcher renderer/IPC contract tests.

**Interfaces:**
- Agent tab strip includes all managed agents, current status and selected manager badge.
- Manager radio/toggle calls owner API; clearing stops loop.
- History list displays run status/time/agent health/screenshots and supports delete/clear.

- [ ] Add renderer contract tests.
- [ ] Add IPC/preload methods.
- [ ] Build tab strip and supervisor/history panel following existing dark launcher visual language.
- [ ] Run launcher tests/typecheck/build.

### Task 7: MCP observation memory access

**Files:**
- Create: `src/council/mcp-tools-observations.ts`
- Modify: `src/council/mcp-server.ts`
- Modify: `tests/council-mcp-contract.test.ts`

**Interfaces:**
- `council_observation_list` returns safe summaries.
- `council_observation_read` returns safe run metadata/manager analysis and bounded health records; no arbitrary file access.

- [ ] Add tool schema/security tests.
- [ ] Register tools only when observation store is available.

### Task 8: Verification and merge

**Files:**
- Update docs/release notes only after behavior is green.

- [ ] Run GitHub Actions for root tests/typecheck/build and launcher tests/typecheck/build.
- [ ] Inspect failed job logs and fix evidenced failures.
- [ ] Merge branch to `main` only when final SHA is green.
