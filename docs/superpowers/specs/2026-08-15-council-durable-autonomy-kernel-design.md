# Council 3.5 Durable Autonomy Kernel — Design

Date: 2026-08-15
Status: proposed for implementation
Base: Council 3.4.0

## 1. Purpose

Council 3.4 can supervise persistent ChatGPT Web agents every 20 minutes, serialize browser work, resume exact conversations, attach the real `CodexWeb Council` connector, and retain bounded observation history. The remaining reliability gap is that the browser-work queue is in-memory and most autonomous recovery is reactive to a manager turn. A process crash, restart, stale browser surface, usage-limited agent, duplicated wake request, or temporarily unavailable ChatGPT session can therefore still interrupt the long-running collaboration loop.

Council 3.5 introduces one coherent subsystem: a **durable autonomy kernel** that owns autonomous work intent, dispatch, health, retry, deduplication, budgets, and restart recovery while preserving Council 3.4's conservative rule that uncertain post-submit failures must never be retried automatically.

## 2. User-visible outcome

After a managed project is started and a Project Manager is selected:

- assigned work can wake sleeping agents without waiting for the next 20-minute screenshot pass;
- review assignment can wake the reviewer automatically;
- mentions can optionally wake a sleeping managed participant when there is actionable work;
- wake/spawn/manager/observation browser operations remain sequential;
- queued work survives Electron/Core restart;
- repeated equivalent wake requests collapse into one durable intent;
- an unavailable or usage-limited agent enters a circuit-breaker state instead of being hammered repeatedly;
- unfinished work can be escalated to the selected manager, and the manager can reassign or spawn a replacement under bounded policy;
- the operator can inspect why an agent is considered healthy, sleeping, stalled, limited, disconnected, or quarantined;
- the system keeps an append-only bounded audit trail of autonomous decisions and dispatch transitions.

The 20-minute screenshot supervisor remains enabled only while the user has selected a manager. Clearing the manager still stops periodic screenshot scans. Event-driven task routing remains active only for the active managed project and only for actions allowed by project policy.

## 3. Scope and decomposition

This design covers the first of four roadmap layers:

1. **Durable Autonomy Kernel (this spec):** durable queue, event triggers, health ledger, circuit breakers, dedupe, budgets, restart recovery, escalation hooks.
2. **Memory/Audit Compaction:** content-addressed screenshot blobs, richer search/filter/pinning, long-horizon summaries and provenance.
3. **Operator Workspace:** richer agent-tab badges, timeline, health dashboard, queue inspector, policy controls.
4. **Advanced Team Policy:** role/capability matching, work stealing, backup manager policy, dynamic team sizing and more advanced scheduling.

Layers 2–4 consume the interfaces introduced here but are deliberately excluded from this implementation plan so the durability foundation can be verified independently.

## 4. Core invariants

1. **At most one browser-affecting managed operation executes at once.**
2. **Durable intent is recorded before browser work starts.**
3. **A work item is never silently lost on process restart.**
4. **Equivalent pending wake intents for the same target/task are coalesced.**
5. **Retries are allowed only when the failure is known to occur before ChatGPT submission.**
6. **An uncertain post-submit failure moves to `uncertain`, never automatic retry.**
7. **No autonomous loop may create unbounded turns, agents, wakes, or storage.**
8. **Sleeping is not a failure.** A sleeping agent with no actionable assigned work remains healthy.
9. **Usage/message limits are treated as a resource condition, not a reason to repeatedly wake the same agent.**
10. **Private conversation URLs, agent tokens, owner bearer tokens, and local filesystem paths never enter public Council messages or MCP-safe audit views.**
11. **The user-selected manager remains authoritative for escalation policy.** If no manager is selected, the kernel may deliver already-authorized direct task/review wakes but may not perform manager-only reassignment/spawn decisions.

## 5. Durable work model

Create `src/council/autonomy-work-store.ts` backed by a private atomic JSON state file under the existing Council private data root.

### 5.1 Work item

Each work item contains:

- `id`: stable UUID-derived id;
- `kind`: `wake | spawn | manager-observation | capture | task-route | review-route | escalation`;
- `projectRoomId`;
- `targetAgentId?`;
- `sourceAgentId?`;
- `taskId?`;
- `wakeId?`;
- `dedupeKey`;
- `priority`: integer 0–100;
- `state`: `queued | leased | running | retry-wait | uncertain | completed | failed | cancelled`;
- `attempt` and `maxAttempts`;
- `notBefore`;
- `leaseOwner` and `leaseExpiresAt?`;
- `createdAt`, `updatedAt`, `completedAt?`;
- `failureCode?` and bounded safe `failureMessage?`;
- `correlationId` for audit/replay grouping.

No prompt body, screenshot bytes, private checkpoint, agent token, owner token, or conversation URL is persisted in this queue. Payloads use stable IDs and are reconstructed from managed/Council stores immediately before execution.

### 5.2 Atomicity

The store follows the repository's existing atomic-private-file pattern: write temp file with restrictive permissions, rename, then publish mutation. Mutations occur through explicit methods (`enqueue`, `leaseNext`, `heartbeatLease`, `complete`, `retry`, `fail`, `uncertain`, `cancel`, `recoverExpiredLeases`) rather than exposing mutable arrays.

### 5.3 Restart recovery

On Core startup:

- `leased` or `running` items with expired leases are inspected;
- operations whose submit boundary was never crossed return to `queued` with bounded backoff;
- operations marked `uncertain` remain stopped and are surfaced to manager/operator review;
- completed/failed/cancelled entries are retained only in bounded audit history, not in the active queue.

## 6. Submit-boundary safety

The browser transport receives an execution observer that emits structured phases:

`lease-acquired → conversation-ready → connector-selected → prompt-attached → files-attached → submit-started → submit-observed → response-streaming → response-complete`.

The durable dispatcher records the last safe phase. Automatic retry is permitted only before `submit-started`. If a network/browser error occurs after `submit-started` and the system cannot prove that ChatGPT rejected the submission, the work item becomes `uncertain`.

This extends Council 3.4's conservative no-duplicate-turn behavior across process restarts.

## 7. Durable dispatcher

Create `src/council/autonomy-dispatcher.ts`.

Responsibilities:

- own exactly one execution loop;
- lease the highest-priority eligible work item, FIFO within equal priority;
- renew work leases while an operation is running;
- invoke existing `CouncilManagedRuntime` operations through narrow adapters;
- apply bounded exponential backoff with jitter for structured pre-submit retryable failures;
- update health/circuit-breaker state after every result;
- continue draining the queue after success/failure without allowing one rejected promise to poison the tail;
- expose a compact snapshot for Electron and MCP-safe status.

The current `CouncilWorkScheduler` remains the final in-process serialization guard during migration, but durable work becomes the source of truth. Once all managed browser entry points are routed through the dispatcher, the in-memory scheduler becomes an internal mutex rather than the owner of queued intent.

## 8. Event-driven routing

Create `src/council/autonomy-router.ts`, subscribing to Council store mutation notifications and using revision/cursor state so the same mutation is not processed twice after restart.

### 8.1 Automatic wake triggers

Generate a durable `task-route` or `review-route` intent when:

- a non-done task gains a managed assignee that is sleeping/stale and has no equivalent active wake;
- a task enters `review` with a managed reviewer/assignee that is sleeping/stale;
- a managed participant is explicitly mentioned in a Council message and the message is actionable under policy;
- a wake event is created through MCP or managed actions and has not yet been durably routed.

### 8.2 Non-triggers

Do not wake merely because:

- a browser tab is parked;
- an agent status is `sleeping` with no actionable work;
- a manager screenshot shows no new activity;
- presence is `stale` while the agent has no task/review/mention requiring action.

### 8.3 Coalescing

Dedupe key examples:

- `wake:<room>:<target>:task:<taskId>`
- `review:<room>:<target>:<taskId>`
- `mention:<room>:<target>:<messageId>`
- `spawn:<room>:<source>:<requestedAgentId-or-role-hash>`

Only one active item per dedupe key is allowed. New reasons may be appended to a bounded reason set in safe metadata rather than creating another turn.

## 9. Agent health ledger

Create `src/council/agent-health.ts` with structured evidence rather than regex-only state.

Each managed agent receives:

- `state`: `healthy | sleeping | busy | stalled | limited | signed-out | disconnected | conversation-missing | surface-missing | quarantined | unknown`;
- `lastSuccessAt?`;
- `lastAttemptAt?`;
- `consecutiveFailures`;
- `lastFailureCode?`;
- `cooldownUntil?`;
- `lastObservedAt?`;
- `evidence`: bounded recent structured records;
- `source`: `browser | supervisor | dispatcher | presence | operator`.

Health is evidence-based. Regex parsing may remain as a compatibility fallback, but browser/transport code should throw structured error classes/codes for known failure categories.

## 10. Circuit breakers and cooldowns

Per-agent circuit-breaker policy:

- `limited`: default cooldown 60 minutes unless the UI exposes a stronger known reset time later;
- `signed-out`: circuit remains open until authentication evidence becomes healthy;
- repeated pre-submit connection failures: exponential cooldown capped at 15 minutes;
- repeated response stalls: cooldown and manager escalation after threshold;
- `conversation-missing`: one controlled resurrection attempt, then manager escalation if recreation fails;
- `uncertain`: no automated turn to that same work intent until manager/operator resolves it.

A successful managed turn closes transient breakers and resets consecutive failure counters.

## 11. Budgets and loop guards

Create `src/council/autonomy-policy.ts` with defaults stored in a versioned policy state:

- maximum managed ChatGPT turns per project per hour;
- maximum automatic wakes per target per hour;
- maximum automatic spawn intents per hour;
- maximum consecutive recovery attempts per agent;
- maximum active durable items per project;
- minimum cooldown between equivalent wake reasons;
- maximum autonomous action depth/correlation chain length;
- maximum queued-item age before escalation/cancellation review.

Policy denial does not silently discard work. It records `blocked-by-policy` audit evidence and, when a manager exists, enqueues one coalesced escalation rather than looping.

## 12. Escalation and conservative work stealing

This version does not autonomously reassign arbitrary tasks based on heuristic capability matching. Instead:

- if an assigned agent is limited/quarantined beyond policy threshold, create one `escalation` intent for the selected manager;
- the manager receives task, agent health, recent audit evidence, and candidate managed agents;
- the manager may use existing Council actions to reassign, request review, or spawn a replacement if its permissions allow;
- all resulting browser operations re-enter the same durable queue and budget system.

This gives the system self-healing behavior without allowing an unverified heuristic scheduler to silently rewrite project ownership.

## 13. Supervisor integration

The 20-minute supervisor remains a separate evidence-gathering policy but routes its browser work through the durable dispatcher.

Changes:

- periodic scan creates one coalesced `manager-observation` intent rather than starting directly;
- per-agent captures remain sequential;
- capture failures update the health ledger;
- if an agent is unchanged and healthy, the screenshot is still captured as requested by the product behavior, but later memory-layer work may deduplicate identical image blobs without changing observation semantics;
- manager analysis receives health-ledger state plus durable queue/audit summary;
- manager actions are subject to the same budgets and dedupe rules as all other automated actions.

Clearing the manager cancels future periodic observation intents and any not-yet-running periodic manager-observation item. It does not erase retained history.

## 14. Audit trail

Create `src/council/autonomy-audit.ts` with bounded append-only records:

- sequence number;
- timestamp;
- correlation id;
- work item id/kind;
- safe actor/target/task ids;
- transition (`created`, `coalesced`, `leased`, `retry`, `uncertain`, `completed`, `failed`, `policy-blocked`, `cancelled`, `recovered-after-restart`);
- structured code and short safe reason.

Default retention: 10,000 events or 30 days, whichever bound prunes first. Audit entries never contain prompt bodies, screenshots, private checkpoints, credentials, conversation URLs, or local paths.

## 15. Public status and operator hooks

Extend managed public state with safe summaries:

- durable queue counts by state/kind;
- active work item summary;
- per-agent health state, cooldown and last-success age;
- breaker-open count;
- recent safe audit events;
- policy budget utilization.

Electron 3.5 may initially surface these through existing Manager/Agent panels with minimal badges and a queue summary. A larger dashboard redesign belongs to roadmap layer 3.

MCP adds read-only safe tools only where useful:

- `council_autonomy_status` — compact project queue/health/budget state;
- `council_autonomy_audit` — bounded safe audit records.

No MCP call receives owner-only deletion/retry controls in this layer.

## 16. Failure codes

Introduce stable codes shared by dispatcher/health/UI, including:

- `CAPACITY_BUSY`
- `SURFACE_UNAVAILABLE`
- `CONVERSATION_UNAVAILABLE`
- `CHATGPT_LIMITED`
- `CHATGPT_SIGNED_OUT`
- `CONNECTION_FAILED`
- `RESPONSE_STALLED`
- `SUBMISSION_UNCERTAIN`
- `POLICY_BUDGET_EXHAUSTED`
- `WORK_LEASE_EXPIRED`
- `WORK_ITEM_STALE`
- `MANAGER_UNAVAILABLE`

Human-readable messages remain bounded diagnostics; policy decisions use codes.

## 17. Migration

- Existing Council 3.4 state remains valid.
- New autonomy state files are additive and versioned.
- Existing pending Council wake events on startup are scanned once and converted to durable wake intents if no equivalent item exists.
- Existing managed agents default to health `unknown/sleeping` until fresh evidence arrives.
- Existing supervisor selection continues to work; the first scheduled scan is routed through the new dispatcher.
- No reset of Council rooms, tasks, messages, managed identities, checkpoints, or observation history is required.

## 18. Testing strategy

### Unit tests

- atomic queue persistence and recovery;
- lease expiry/recovery;
- priority/FIFO ordering;
- dedupe/coalescing;
- retry boundary before vs. after submit;
- circuit-breaker transitions;
- budget windows and cooldowns;
- mutation router idempotency;
- task/review/mention wake generation;
- manager escalation coalescing;
- audit redaction/retention.

### Integration tests

- task assigned to sleeping agent → exactly one durable wake → exact conversation resumed;
- duplicate task updates/messages → no duplicate ChatGPT turn;
- restart with queued wake → wake executes after restart;
- restart with expired pre-submit lease → safe retry;
- restart after `submit-started` without completion → `uncertain`, no duplicate turn;
- usage-limited agent → breaker opens → manager escalation → no repeated wake storm;
- manager cleared → periodic supervisor intents stop;
- manager selected → initial scan then 20-minute cadence remains intact;
- all browser-affecting work remains globally sequential.

### CI gates

Use the repository's full existing `bun run verify`, launcher package, and packaged smoke matrix on macOS, Windows, and Ubuntu. New tests must run in the normal test suites rather than a separate optional workflow.

## 19. Acceptance criteria

Council 3.5 Durable Autonomy Kernel is complete only when all are true:

1. queued managed work survives a real process restart test;
2. task/review assignment can wake a sleeping managed agent without waiting for the periodic manager scan;
3. duplicate equivalent wake triggers produce at most one ChatGPT turn;
4. usage-limited/signed-out agents are not repeatedly awakened;
5. a post-submit ambiguous failure never auto-retries;
6. queue/health/budget state is inspectable without leaking private continuity data;
7. supervisor scans and all managed wake/spawn work still serialize globally;
8. clearing the manager stops future periodic screenshots;
9. existing Council 3.4 state migrates without reset;
10. full cross-platform CI, package and smoke gates pass.

## 20. Explicit non-goals for this layer

- semantic capability ranking of agents;
- automatic reassignment without manager authorization;
- replacing the selected manager automatically;
- cloud/distributed multi-machine coordination;
- storing full ChatGPT transcripts outside ChatGPT;
- OCR of screenshots;
- unbounded vector memory;
- parallel browser automation.

Those may be designed as later layers once the durable autonomy kernel is proven.