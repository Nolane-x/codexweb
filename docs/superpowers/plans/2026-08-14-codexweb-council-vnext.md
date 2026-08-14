# CodexWeb Council vNext Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Electron launcher reflect authoritative shared Council state independently of local execution tooling, then harden presence/wake lifecycle, repository workspace safety, UX/observability, and ship a verified 3.2.0 release candidate.

**Architecture:** The existing `CouncilStore` remains the only durable Council domain store. A new Electron-main `CouncilConnectionSupervisor` owns only transport/projection lifecycle and publishes a typed runtime view through preload IPC; renderer components never derive shared-state visibility from the local Tunnel/Full MCP runtime. The Council HTTP service gains versioned snapshot/continuation semantics without a second store, while action gating and repository execution safety remain pure/domain-boundary concerns.

**Tech Stack:** Bun 1.3.14, TypeScript 5.9, Electron 41, React 19, Node test runner/Bun tests, GitHub Actions multi-platform package/smoke pipeline.

## Global Constraints

- Shared-state visibility is gated only by the last authoritative canonical projection; managed-project attachment and execution capabilities never erase rooms/messages/participants.
- `0 rooms / 0 participants` is authoritative only when projection sync is `live` and the synchronized snapshot is genuinely empty.
- Action availability is capability-specific; no global Council/runtime boolean may gate unrelated actions.
- `CouncilStore` remains the sole durable shared Council state store.
- Renderer/shared logs receive structured safe reason codes and sanitized metadata only; no raw credential-bearing exceptions/tokens.
- Snapshot continuation cursor is opaque to clients.
- GitHub credentials stay outside Council shared state; repository work pins `repoId + baseCommit` and rejects stale bases.
- No production behavior change is written before its failing regression test is committed and observed failing in CI.
- Stable release tagging is allowed only after the supported GitHub Actions package/smoke matrix is green.

---

## File Structure

### New files
- `launcher/electron/council-connection-supervisor.cjs` — ephemeral canonical Council transport/projection owner, reconnect/resync, safe reasons.
- `launcher/src/council-runtime.ts` — renderer-side typed Council runtime/view contracts and pure selectors/action policy helpers.
- `launcher/tests/council-connection-supervisor.test.cjs` — transport/projection state-machine tests.
- `tests/council-http-sync.test.ts` — HTTP snapshot/cursor/continuation contract tests.
- `src/council/repo-workspace.ts` — repository binding and stale-base validation primitives.
- `tests/council-repo-workspace.test.ts` — repository binding/receipt tests.

### Modified files
- `src/council/http-server.ts` — versioned atomic snapshot envelope, opaque cursor and bounded continuation endpoint/stream contract.
- `src/council/store.ts` — in-memory monotonic mutation epoch/observer hook only; no new durable domain store.
- `src/council/types.ts` — lifecycle-compatible wake/presence fields if required by Phase B.
- `src/council/wake-engine.ts`, `src/council/work-operations.ts` — observable wake transitions.
- `launcher/electron/main-council.cjs` — instantiate supervisor, include Council runtime projection in snapshot, publish updates.
- `launcher/electron/preload.cjs` — expose read-only Council runtime snapshot/subscription IPC.
- `launcher/src/types.ts` — add Council runtime to launcher API/snapshot.
- `launcher/src/CouncilDock.tsx` — stop direct loopback polling; render live/stale/error/unknown semantics and retained data.
- `launcher/src/CouncilAgentsPanel.tsx` — consume managed/capability state from the same projection rather than inferring runtime health.
- `launcher/src/council.css`, `launcher/src/council-agents.css` — status hierarchy/chips/stale indicators.
- `launcher/tests/council-renderer-contract.test.cjs`, `launcher/tests/council-runtime-behavior.test.cjs`, `launcher/tests/council-control-server.test.cjs` — vertical regression and legacy-boolean migration assertions.
- `package.json`, `launcher/package.json`, README/release docs — 3.2.0 release candidate metadata after gates pass.

---

### Task 1: RED vertical regression — shared Council stays visible when local tools are unavailable

**Files:**
- Test: `launcher/tests/council-renderer-contract.test.cjs`
- Test: `launcher/tests/council-connection-supervisor.test.cjs`

**Interfaces:**
- Consumes: current `CouncilDock`, current launcher IPC.
- Produces: failing tests describing `controlPlane`, `projection`, `managedProject`, and capability semantics.

- [ ] Add a regression test fixture with two rooms, two participants and one message, while managed project is unattached and all execution capabilities are unavailable.
- [ ] Assert shared data remains visible/selected when `projection.syncState === "live"` regardless of capabilities.
- [ ] Add hydrate-error cases: no last-good snapshot => `error/unknown`, last-good snapshot => `stale` retaining data; neither may become authoritative `0/0`.
- [ ] Run the launcher test suite in GitHub Actions and record the expected RED failure caused by missing supervisor/runtime-view implementation.
- [ ] Commit only the failing tests.

### Task 2: Typed semantic state and pure action policy

**Files:**
- Create: `launcher/src/council-runtime.ts`
- Modify: `launcher/src/types.ts`
- Test: `launcher/tests/council-renderer-contract.test.cjs`

**Interfaces:**
- Produces `SafeReasonCode`, `SafeReason`, `ControlPlaneState`, `SharedProjectionState<T>`, `ManagedProjectState`, `CapabilityName`, `CapabilityState`, `CouncilRuntimeViewState<T>`, and `evaluateAction()`.

- [ ] Extend the RED tests to exercise the pure policy evaluator: a missing local repo disables only actions requiring `localRepo`; reading Council remains enabled when a live/stale projection exists.
- [ ] Add discriminated/typed runtime contracts with explicit `live/stale/error` projection states and safe reason codes.
- [ ] Implement a pure requirement registry/evaluator with no UI copy and no Electron imports.
- [ ] Run launcher tests/typecheck; keep changes minimal until GREEN.
- [ ] Commit semantic state/policy.

### Task 3: Canonical snapshot + opaque continuation contract

**Files:**
- Create: `tests/council-http-sync.test.ts`
- Modify: `src/council/store.ts`
- Modify: `src/council/http-server.ts`

**Interfaces:**
- Produces snapshot envelope `{schemaVersion:1,state,cursor,generatedAt}` and continuation semantics that treat cursor as opaque.

- [ ] Write failing Bun tests proving snapshot state and cursor share one boundary, and invalid/expired continuation returns a typed resync requirement rather than empty data.
- [ ] Add an in-memory mutation epoch/notification hook to `CouncilStore`; do not persist a second event log.
- [ ] Add `/api/sync/snapshot` and a bounded continuation endpoint/stream using opaque cursor tokens generated/validated server-side.
- [ ] Preserve existing `/api/state` compatibility for 3.1 clients during this release.
- [ ] Run root Council tests and typecheck; commit when GREEN.

### Task 4: Electron-main CouncilConnectionSupervisor + IPC vertical slice

**Files:**
- Create: `launcher/electron/council-connection-supervisor.cjs`
- Modify: `launcher/electron/main-council.cjs`
- Modify: `launcher/electron/preload.cjs`
- Modify: `launcher/src/types.ts`
- Test: `launcher/tests/council-connection-supervisor.test.cjs`
- Test: `launcher/tests/council-runtime-behavior.test.cjs`

**Interfaces:**
- `CouncilConnectionSupervisor.snapshot()` returns current runtime view and last-good public Council state.
- Supervisor publishes `launcher:council-runtime` updates; preload exposes `councilRuntime()` and `onCouncilRuntime()`.

- [ ] Write/extend failing tests for initial hydrate, stale retention, safe error sanitation, reconnect and `RESYNC_REQUIRED` rehydrate.
- [ ] Implement one supervisor-owned upstream session/loopback control-plane connection independent of `RuntimeSupervisor` local tool state.
- [ ] Add Council runtime to `launcher:snapshot` and a dedicated IPC event; do not expose secrets/private checkpoints.
- [ ] Verify renderer reload/subscription does not create a second durable state owner.
- [ ] Run launcher tests/typecheck and commit when GREEN.

### Task 5: Renderer migration — remove scalar `online` truth

**Files:**
- Modify: `launcher/src/CouncilDock.tsx`
- Modify: `launcher/src/CouncilAgentsPanel.tsx`
- Modify: `launcher/src/council.css`
- Modify: `launcher/src/council-agents.css`
- Modify: `launcher/tests/council-renderer-contract.test.cjs`

**Interfaces:**
- Consumes `LauncherSnapshot.councilRuntime` and `onCouncilRuntime`.

- [ ] Add failing contract assertions that `CouncilDock` no longer fetches `127.0.0.1:17842` directly and no longer uses a scalar `online` to erase content.
- [ ] Refactor Dock state to consume main-process projection; render last-good shared data under `stale` with a reconnecting indicator.
- [ ] Render primary shared-sync status, secondary managed-project badge, and capability chips independently.
- [ ] Ensure error-without-last-good renders unknown/sync error, not zero counts.
- [ ] Sweep launcher active code/tests for composite `online/offline/runtimeOnline/isConnected` semantics controlling Council visibility/action gating.
- [ ] Run launcher tests/typecheck/build; commit when GREEN.

### Task 6: Presence and wake lifecycle consistency

**Files:**
- Modify: `src/council/types.ts`
- Modify: `src/council/work-operations.ts`
- Modify: `src/council/wake-engine.ts`
- Modify: `src/council/http-server.ts`
- Test: root Council wake/presence tests and new focused cases.

**Interfaces:**
- Presence keeps explicit status plus heartbeat freshness metadata.
- Wake UI/public snapshot exposes observable lifecycle compatible with queued/dispatched/target-running/replied/failed/expired semantics.

- [ ] Write failing tests for stale heartbeat not rewriting explicit status to offline and queue counts matching observable active wakes.
- [ ] Add lease/freshness metadata without making a socket connection authoritative presence.
- [ ] Normalize legacy wake statuses into the new observable lifecycle at the public projection boundary, preserving persisted-state migration compatibility.
- [ ] Add timestamps/reasons needed for diagnosis while sanitizing shared errors.
- [ ] Run root tests/typecheck; commit when GREEN.

### Task 7: Phase C repository workspace binding + STALE_BASE guard

**Files:**
- Create: `src/council/repo-workspace.ts`
- Create: `tests/council-repo-workspace.test.ts`
- Modify: `src/council/types.ts` or managed-project metadata boundary only if needed.

**Interfaces:**
- `RepoWorkspaceBinding` pins provider/repo identity/default branch/base commit.
- `validateRepoBase(binding,currentHead)` returns success or a typed `STALE_BASE` receipt.

- [ ] Write failing tests proving credentials/paths are absent from shared binding and HEAD movement is rejected.
- [ ] Implement version-1 GitHub binding and typed execution receipt primitives.
- [ ] Keep OAuth/PAT material entirely outside these structures.
- [ ] Integrate only normalized metadata/receipts into Council project/task surfaces; large diffs remain repository-layer data.
- [ ] Run root tests/typecheck; commit when GREEN.

### Task 8: Observability and correlation-safe diagnostics

**Files:**
- Modify: `launcher/electron/council-connection-supervisor.cjs`
- Modify: `launcher/electron/logging.cjs` only if required for safe structured fields.
- Modify: `launcher/src/CouncilApp.tsx` Activity presentation if required.
- Tests: launcher logging/supervisor tests.

- [ ] Write failing tests that raw authorization/tunnel/token text never reaches renderer runtime reasons/log payloads.
- [ ] Add structured correlation IDs and metrics/events for hydrate latency, reconnect/resync, stale duration, wake transitions and stale-base receipts.
- [ ] Keep sensitive details private to local diagnostic logs and sanitize renderer/shared payloads.
- [ ] Run security-adjacent logging tests and full launcher suite; commit when GREEN.

### Task 9: Full verification, review, merge and release-candidate packaging

**Files:**
- Modify: `package.json`
- Modify: `launcher/package.json`
- Modify: `README.md`
- Modify release notes/docs as required by current repository conventions.

- [ ] Run `bun run verify` in GitHub Actions on the PR head.
- [ ] Require Windows x64, Linux x64, macOS x64 and macOS arm64 package/smoke jobs required by the repository release policy to be green.
- [ ] Review CI logs/artifacts for warnings/security regressions; rerun only failed jobs after a justified fix.
- [ ] Ask Council reviewers for blocker-only architecture/code review against the approved invariants and resolve blockers.
- [ ] Bump root/launcher versions consistently to `3.2.0` only after implementation gates are green; rerun version checks/build/package/smoke.
- [ ] Merge to `main` only after all required checks pass.
- [ ] Produce/download verified workflow artifacts available through the connector. If the connector cannot create a Git tag/GitHub Release, stop at a fully verified release-ready `main` and report that exact tooling limitation rather than simulating a release.
