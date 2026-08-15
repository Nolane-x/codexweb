# Council 3.5 Durable Autonomy Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make managed Council work durable, restart-safe, event-driven, deduplicated, health-aware, budgeted, and observable without ever auto-retrying an uncertain post-submit ChatGPT turn.

**Architecture:** Introduce a private durable work store as the source of truth, a single dispatcher that leases and executes work through existing managed runtime/browser primitives, an event router that converts Council mutations into durable intents, and structured health/policy/audit modules. Existing `CouncilWorkScheduler` remains the final in-process serialization mutex while durable state owns intent and restart recovery.

**Tech Stack:** Bun 1.3.14, TypeScript 5.9, Playwright Core 1.62, Electron 41, existing Council JSON/atomic-file stores, bun:test.

## Global Constraints

- At most one browser-affecting managed operation executes at once.
- Durable intent must be persisted before browser work starts.
- Retries are allowed only for failures proven to happen before `submit-started`.
- Any ambiguous failure after `submit-started` becomes `uncertain` and is never auto-retried.
- Sleeping is normal and must not by itself trigger wake.
- Private conversation URLs, checkpoints, tokens, owner credentials, local paths, prompt bodies, and screenshot bytes must never enter MCP-safe status/audit data.
- Default limited-agent cooldown is 60 minutes; transient connection cooldown is exponential and capped at 15 minutes.
- Audit retention is bounded to 10,000 events or 30 days.
- Existing Council 3.4 state must migrate without reset.
- Full `bun run verify`, launcher packaging, and packaged smoke must pass on macOS, Windows, and Ubuntu before merge.

---

### Task 1: Stable failure taxonomy and submit-boundary phases

**Files:**
- Create: `src/council/autonomy-errors.ts`
- Modify: `src/council/browser-transport.ts`
- Modify: `src/council/playwright-council-driver.ts`
- Test: `tests/council-browser-transport.test.ts`
- Create: `tests/council-autonomy-errors.test.ts`

**Interfaces:**
- Produces `CouncilFailureCode`, `CouncilExecutionPhase`, `CouncilAutonomyError`, `classifyCouncilFailure(error)`.
- `CouncilBrowserTransport.run()` accepts optional `onPhase(phase)` and emits monotonic phases through `response-complete`.

- [ ] **Step 1: Write failing failure-code tests**

```ts
import { describe, expect, test } from "bun:test";
import { CouncilAutonomyError, classifyCouncilFailure } from "../src/council/autonomy-errors";

describe("Council autonomy errors", () => {
  test("preserves structured codes", () => {
    expect(classifyCouncilFailure(new CouncilAutonomyError("CHATGPT_LIMITED", "limit"))).toEqual({ code: "CHATGPT_LIMITED", retryableBeforeSubmit: false });
  });
  test("maps legacy capacity messages conservatively", () => {
    expect(classifyCouncilFailure(new Error("all browser surfaces are busy")).code).toBe("CAPACITY_BUSY");
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `bun test tests/council-autonomy-errors.test.ts tests/council-browser-transport.test.ts`
Expected: FAIL because autonomy error types/phase observer do not exist.

- [ ] **Step 3: Implement structured taxonomy**

```ts
export type CouncilFailureCode =
  | "CAPACITY_BUSY" | "SURFACE_UNAVAILABLE" | "CONVERSATION_UNAVAILABLE"
  | "CHATGPT_LIMITED" | "CHATGPT_SIGNED_OUT" | "CONNECTION_FAILED"
  | "RESPONSE_STALLED" | "SUBMISSION_UNCERTAIN" | "POLICY_BUDGET_EXHAUSTED"
  | "WORK_LEASE_EXPIRED" | "WORK_ITEM_STALE" | "MANAGER_UNAVAILABLE" | "UNKNOWN";

export type CouncilExecutionPhase =
  | "lease-acquired" | "conversation-ready" | "connector-selected" | "prompt-attached"
  | "files-attached" | "submit-started" | "submit-observed" | "response-streaming" | "response-complete";
```

Implement `CouncilAutonomyError` with `code` and `retryableBeforeSubmit`, plus compatibility regex mapping only as fallback.

- [ ] **Step 4: Emit transport phases around the real submission boundary**

`CouncilBrowserTransport.run()` and the Playwright driver must call `onPhase` before/after the exact points where connector selection, prompt attachment, submission, and response observation occur. Phase callbacks are telemetry and must not alter turn semantics if they throw; wrap callbacks and surface only local diagnostics.

- [ ] **Step 5: Run focused tests**

Run: `bun test tests/council-autonomy-errors.test.ts tests/council-browser-transport.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: add structured Council failure and submit phases`.

---

### Task 2: Durable autonomy work store

**Files:**
- Create: `src/council/autonomy-work-store.ts`
- Create: `tests/council-autonomy-work-store.test.ts`

**Interfaces:**
- Produces `AutonomyWorkItem`, `AutonomyWorkKind`, `AutonomyWorkState`, `CouncilAutonomyWorkStore`.
- Required methods: `enqueue`, `leaseNext`, `markRunning`, `heartbeatLease`, `recordPhase`, `complete`, `retry`, `fail`, `uncertain`, `cancel`, `cancelWhere`, `recoverExpiredLeases`, `active`, `snapshot`.

- [ ] **Step 1: Write persistence/dedupe/order/recovery tests**

Tests must cover:

```ts
const first = store.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "bob", dedupeKey: "wake:r:bob:task:t1", priority: 80, maxAttempts: 4 });
const second = store.enqueue({ kind: "wake", projectRoomId: "r", targetAgentId: "bob", dedupeKey: "wake:r:bob:task:t1", priority: 80, maxAttempts: 4 });
expect(second.id).toBe(first.id);
expect(store.snapshot().items).toHaveLength(1);
```

Also reopen the store from disk and verify queued data survives, priority/FIFO ordering, expired pre-submit leases requeue, and expired leases whose last phase is `submit-started` become `uncertain`.

- [ ] **Step 2: Run the new test and confirm failure**

Run: `bun test tests/council-autonomy-work-store.test.ts`
Expected: FAIL because store does not exist.

- [ ] **Step 3: Implement atomic private persistence**

Use a versioned state `{ version: 1, revision, items }`. Write through temp file mode `0600`, parent directory mode `0700`, atomic rename. Validate loaded data and fail closed to a fresh empty store only for absent file; malformed existing data must be preserved/renamed for diagnostics and must not silently execute corrupted work.

- [ ] **Step 4: Implement deterministic leasing**

Eligible items are `queued` or due `retry-wait`; sort by priority descending, then `createdAt`, then `id`. Lease writes `leaseOwner`/`leaseExpiresAt` before returning the item.

- [ ] **Step 5: Implement restart recovery**

If lease expired and phase is earlier than `submit-started`, requeue with `WORK_LEASE_EXPIRED`; if phase is `submit-started` or later without completion, mark `uncertain` with `SUBMISSION_UNCERTAIN`.

- [ ] **Step 6: Run focused test**

Run: `bun test tests/council-autonomy-work-store.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: persist durable Council autonomy work`.

---

### Task 3: Bounded autonomy audit trail

**Files:**
- Create: `src/council/autonomy-audit.ts`
- Create: `tests/council-autonomy-audit.test.ts`

**Interfaces:**
- Produces `CouncilAutonomyAuditStore.append()`, `.list(limit)`, `.summary()`.
- Audit fields are safe IDs and bounded messages only.

- [ ] **Step 1: Write redaction/retention tests**

Construct events with a safe reason and assert persisted records contain no keys named `conversationUrl`, `prompt`, `checkpoint`, `token`, `path`, `screenshot`, and prune past 10,000/30 days using injectable clock/limits in tests.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test tests/council-autonomy-audit.test.ts`.

- [ ] **Step 3: Implement append-only bounded audit state**

Use private atomic JSON and a monotonically increasing `sequence`. Transitions include `created`, `coalesced`, `leased`, `running`, `phase`, `retry`, `uncertain`, `completed`, `failed`, `policy-blocked`, `cancelled`, `recovered-after-restart`.

- [ ] **Step 4: Run focused test and commit**

Run: `bun test tests/council-autonomy-audit.test.ts`
Commit: `feat: add bounded autonomy audit trail`.

---

### Task 4: Structured agent health ledger and circuit breakers

**Files:**
- Create: `src/council/agent-health.ts`
- Create: `tests/council-agent-health.test.ts`

**Interfaces:**
- Produces `CouncilAgentHealthLedger`, `CouncilAgentHealthState`, `CouncilAgentHealthRecord`.
- Methods: `observeSuccess`, `observeFailure`, `observeSleeping`, `observeSupervisor`, `canAttempt`, `snapshot`, `get`.

- [ ] **Step 1: Write health transition tests**

Cover healthy reset, limited 60-minute cooldown, signed-out open breaker, exponential connection cooldown capped at 15 minutes, response-stall escalation threshold, and sleeping not increasing failure count.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test tests/council-agent-health.test.ts`.

- [ ] **Step 3: Implement evidence-bounded state**

Retain at most 20 evidence records per agent. Use structured failure codes first. `canAttempt` returns `{ allowed, reasonCode?, retryAt? }`.

- [ ] **Step 4: Run focused test and commit**

Run: `bun test tests/council-agent-health.test.ts`
Commit: `feat: track Council agent health and circuit breakers`.

---

### Task 5: Autonomy budgets and loop guards

**Files:**
- Create: `src/council/autonomy-policy.ts`
- Create: `tests/council-autonomy-policy.test.ts`

**Interfaces:**
- Produces `CouncilAutonomyPolicy`, `CouncilAutonomyBudgetLedger`, `checkIntent`, `recordExecution`.

- [ ] **Step 1: Write budget-window tests**

Defaults to encode explicitly: 60 managed turns/project/hour, 12 automatic wakes/target/hour, 6 automatic spawn intents/project/hour, 6 consecutive recovery attempts/agent, 200 active durable items/project, 60-second equivalent-wake cooldown, max correlation depth 12, stale queued age 6 hours.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test tests/council-autonomy-policy.test.ts`.

- [ ] **Step 3: Implement policy evaluation**

Return structured denial `{ allowed: false, code: "POLICY_BUDGET_EXHAUSTED", reason }`; never delete the denied work silently.

- [ ] **Step 4: Run focused test and commit**

Run: `bun test tests/council-autonomy-policy.test.ts`
Commit: `feat: bound Council autonomous work budgets`.

---

### Task 6: Durable dispatcher

**Files:**
- Create: `src/council/autonomy-dispatcher.ts`
- Modify: `src/council/managed-runtime.ts`
- Modify: `src/council/agent-manager.ts`
- Create: `tests/council-autonomy-dispatcher.test.ts`

**Interfaces:**
- Dispatcher receives store, audit, health, budget, clock and an `execute(item, hooks)` adapter.
- `hooks.onPhase` persists phases before browser progression continues.
- Snapshot exposes active item and counts only.

- [ ] **Step 1: Write dispatcher tests**

Cover one-at-a-time execution, retry of structured pre-submit errors, `uncertain` after post-submit failure, health updates, policy block audit, and continuation after a failed item.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test tests/council-autonomy-dispatcher.test.ts`.

- [ ] **Step 3: Implement lease/heartbeat loop**

Use one dispatcher loop and 30-second work leases renewed every 10 seconds. The dispatcher drains eligible work, sleeps when none exists, and wakes on enqueue notification. It must have `start()`, `stop()`, `kick()`, `idle()`, `snapshot()`.

- [ ] **Step 4: Enforce submit boundary**

Persist each phase synchronously to the work store. On failure, inspect persisted last phase; retry only when phase is absent or earlier than `submit-started` and classifier says retryable. Otherwise mark `uncertain`.

- [ ] **Step 5: Route managed runtime entry points through durable intent adapters**

Add narrow execution methods that perform an already-leased durable wake/spawn/observation without recursively creating another durable item. Keep `CouncilWorkScheduler` as the final serialized browser mutex.

- [ ] **Step 6: Run focused dispatcher + existing manager tests**

Run: `bun test tests/council-autonomy-dispatcher.test.ts tests/council-agent-manager.test.ts tests/council-browser-transport.test.ts`.

- [ ] **Step 7: Commit**

Commit: `feat: dispatch durable Council work safely`.

---

### Task 7: Idempotent event-driven task/review/wake router

**Files:**
- Create: `src/council/autonomy-router.ts`
- Modify: `src/council/store.ts`
- Create: `tests/council-autonomy-router.test.ts`

**Interfaces:**
- Router consumes `CouncilStore.snapshotWithRevision()` and `onMutation()`.
- Persists `lastProcessedRevision` in private router state.
- Emits durable work through work-store `enqueue` only.

- [ ] **Step 1: Write routing tests**

Cover sleeping assignee with non-done task → one wake; review assignee → one review wake; actionable mention → one wake; duplicate revisions → no duplicate; sleeping/no work → no wake; already-active equivalent wake → coalesced.

- [ ] **Step 2: Run and confirm failure**

Run: `bun test tests/council-autonomy-router.test.ts`.

- [ ] **Step 3: Implement revision-safe router**

On startup scan current snapshot once, then subscribe to mutations. Use dedupe keys specified in the design. Route pending Council wake events created through MCP/managed actions into durable wake intents.

- [ ] **Step 4: Run focused test and commit**

Run: `bun test tests/council-autonomy-router.test.ts`
Commit: `feat: route Council work from live task events`.

---

### Task 8: Manager escalation and supervisor integration

**Files:**
- Modify: `src/council/supervisor.ts`
- Modify: `src/council/managed-runtime.ts`
- Modify: `src/council/mcp-main.ts`
- Test: `tests/council-supervisor.test.ts`
- Create: `tests/council-autonomy-integration.test.ts`

**Interfaces:**
- Periodic supervisor timer enqueues one `manager-observation` intent.
- Clearing manager cancels queued periodic observation intents.
- Escalation intent targets selected manager and contains only IDs; runtime reconstructs task/health/audit context at execution.

- [ ] **Step 1: Extend supervisor tests**

Verify selection enqueues initial observation after short delay, 20-minute cadence schedules subsequent intent, clearing manager cancels queued periodic intent, and direct event-driven task wakes remain unaffected.

- [ ] **Step 2: Implement manager observation as durable work**

Timer callback must never call browser capture directly. It records durable observation intent and kicks dispatcher. Running observation still captures agents sequentially.

- [ ] **Step 3: Implement coalesced escalation**

When target breaker blocks assigned work beyond threshold, enqueue `escalation:<room>:<manager>:<task>` once. Manager prompt includes safe health summary, task IDs/data, candidate agent IDs/roles, bounded audit summary, and existing observation memory.

- [ ] **Step 4: Run supervisor/integration tests and commit**

Run: `bun test tests/council-supervisor.test.ts tests/council-autonomy-integration.test.ts`
Commit: `feat: make Council supervision event driven and durable`.

---

### Task 9: Safe MCP status/audit surfaces and public managed projection

**Files:**
- Create: `src/council/mcp-tools-autonomy.ts`
- Modify: `src/council/mcp-server.ts`
- Modify: `src/council/http-server.ts`
- Modify: `src/council/managed-runtime.ts`
- Modify: `tests/council-mcp-contract.test.ts`
- Create: `tests/council-autonomy-public-view.test.ts`

**Interfaces:**
- `council_autonomy_status`: compact queue/health/budget snapshot.
- `council_autonomy_audit`: bounded safe audit list, optional limit capped at 200.

- [ ] **Step 1: Write contract/redaction tests**

Assert both tools are registered, read-only, and serialized output never contains private URL/token/path/prompt/checkpoint fields.

- [ ] **Step 2: Implement safe projection**

Expose counts by state/kind, active item IDs/kind/target only, agent health/cooldown/last success, breaker count, budget utilization, recent safe audit.

- [ ] **Step 3: Run MCP/public-view tests and commit**

Run: `bun test tests/council-mcp-contract.test.ts tests/council-autonomy-public-view.test.ts`
Commit: `feat: expose safe Council autonomy status`.

---

### Task 10: Minimal Electron autonomy visibility

**Files:**
- Modify: `launcher/src/types.ts`
- Modify: `launcher/src/CouncilSupervisorPanel.tsx`
- Modify: `launcher/src/council-supervisor.css`
- Modify: `launcher/src/CouncilApp.tsx`
- Test: active launcher tests under `launcher/tests/*.test.cjs`

**Interfaces:**
- Renderer consumes only existing safe Council projection; no owner token is exposed.

- [ ] **Step 1: Add renderer wiring test assertions**

Verify autonomy queue/health data is represented in types/UI source and no renderer path reads owner-control files directly.

- [ ] **Step 2: Add compact status cards**

Show durable queued/running/uncertain counts, breaker-open count, selected manager, last scan, and per-agent health badge/cooldown in project tabs/manager panel. Do not add mutation controls for retry/cancel in 3.5.

- [ ] **Step 3: Run launcher tests/build**

Run: `bun run launcher:test && bun run launcher:typecheck && bun run launcher:build`
Expected: PASS.

- [ ] **Step 4: Commit**

Commit: `feat: surface Council autonomy health in Electron`.

---

### Task 11: Migration, startup recovery, version and release notes

**Files:**
- Modify: `src/council/mcp-main.ts`
- Modify: `src/version.ts`
- Modify: `package.json`
- Modify: `launcher/package.json`
- Modify: `scripts/install.sh`
- Create: `docs/releases/3.5.0.md`
- Create: `tests/council-autonomy-restart.test.ts`

**Interfaces:**
- Startup constructs stores, calls `recoverExpiredLeases`, imports pending 3.4 wake events idempotently, starts dispatcher/router, then supervisor.

- [ ] **Step 1: Write restart migration test**

Persist a queued wake, reconstruct runtime stores, verify it is still queued and dispatched once. Persist an expired pre-submit running item and verify requeue; persist post-submit item and verify `uncertain`.

- [ ] **Step 2: Implement startup lifecycle order**

Stop order must reverse startup: supervisor/router stop producing intent, dispatcher stops accepting/leases, wait boundedly for safe idle, then close runtime resources. Never coerce `uncertain` items during shutdown.

- [ ] **Step 3: Bump synchronized version to `3.5.0` and write release notes**

Update all version-synchronized locations required by `scripts/check-version.ts`; do not change Bun/dependency pins.

- [ ] **Step 4: Run restart/version tests and commit**

Run: `bun test tests/council-autonomy-restart.test.ts && bun run check-version`
Commit: `release: prepare Council 3.5.0 durable autonomy`.

---

### Task 12: Full regression, package, smoke, PR review and merge

**Files:**
- All changed files only as required by failures discovered during verification.

**Interfaces:**
- No new interfaces; this is the release gate.

- [ ] **Step 1: Run full repository verification**

Run: `bun run verify`
Expected: exit 0, no test/typecheck/audit/license failures.

- [ ] **Step 2: Run launcher packaging and smoke locally where available**

Run: `bun run app:package && bun run app:smoke`
Expected: exit 0.

- [ ] **Step 3: Push final branch state and wait for GitHub CI matrix**

Required jobs: actionlint plus verify/package/smoke on macOS, Windows, Ubuntu. Do not mark PR ready while any job is pending/failing.

- [ ] **Step 4: Review the complete PR diff against this plan and the design spec**

Check all ten acceptance criteria, no private continuity leakage, no post-submit retry path, no direct parallel browser automation, and no manager-off periodic screenshots.

- [ ] **Step 5: Mark PR ready and squash-merge only after all gates are green**

Expected final base: `main`, version `3.5.0`.
