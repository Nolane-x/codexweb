# Council 3.6 Memory, Operator, and Team Policy — Design

Date: 2026-08-15
Base: Council 3.5 durable autonomy

## Goal

Council 3.6 completes the next reliability layer around long-running multi-ChatGPT projects. Council already has persistent conversations, durable wake/spawn work, a 20-minute screenshot manager, health/circuit breakers, restart recovery and bounded observations. This release makes old evidence useful without uncontrolled growth, gives the operator a safe control surface for exceptional states, and adds deterministic stale-work escalation so the team can continue for long periods without creating wake storms.

## Invariants

1. Historical memory is bounded, deletable and provenance-preserving.
2. Screenshot storage is content-addressed and deduplicated; deleting one observation never deletes a blob still referenced by another observation.
3. AI memory reads never expose filesystem paths, credentials, private conversation URLs, private checkpoints or raw owner controls.
4. Autonomous routing remains globally sequential and budget-limited.
5. An unchanged task does not cause repeated wake turns.
6. A stale task creates one coalesced manager escalation, not a direct reassignment loop.
7. `uncertain` post-submit work can only be resolved by the local operator. Automatic retry remains forbidden.
8. Operator mutations stay behind loopback owner authentication and Electron main-process IPC; MCP gets read-only memory/status search.
9. Clearing the selected Project Manager continues to stop future periodic screenshots.
10. Existing Council 3.4/3.5 state migrates without reset.

## 1. Content-addressed evidence archive

Introduce `CouncilEvidenceStore` under the private Council data root.

- PNG screenshot bytes are hashed with SHA-256.
- Blobs live once under a private `blobs/<sha256>.png` namespace.
- A small versioned manifest tracks byte size, first/last reference time and reference count.
- Observation records store only safe opaque blob IDs, never local paths.
- Repeated identical screenshots reuse the same blob.
- Deleting an observation decrements references; unreferenced blobs are garbage-collected.
- A migration adapter can import existing 3.4/3.5 per-run PNGs lazily when they are read or when the archive is compacted.
- Retention remains bounded by run count/bytes, but dedupe makes long-running screenshot supervision substantially cheaper.

## 2. Long-horizon memory index

Introduce `CouncilMemoryIndex` built from safe, already-persisted Council evidence:

- manager analyses;
- observation health manifests;
- decisions;
- completed/blocked task summaries;
- safe autonomy audit transitions.

Each entry contains timestamp, project/room ID, source type, stable source ID, bounded text, agent/task references and provenance. No full ChatGPT transcript is copied into the memory index.

Memory is searchable with deterministic token-normalized lexical scoring plus recency weighting. This avoids adding an embedding/model dependency to the local runtime while still letting an AI retrieve relevant old events. Search is bounded by result count and text size.

A daily/project-size compactor writes a short longitudinal digest from already-safe manager analyses and decision/task metadata. It never invents facts: each digest section carries source IDs. Digests are rebuilt when referenced source records are deleted.

New authenticated read-only MCP tools:

- `council_memory_search`
- `council_memory_recent`

They return safe excerpts/provenance only.

## 3. Historical data management

Electron expands the existing retained-observation panel into a Memory view:

- search by text;
- filter by health, agent and date;
- inspect observation/manager analysis;
- see dedupe/storage statistics;
- delete one observation;
- clear all retained observations/memory;
- pin selected important observations against automatic retention pruning.

Pinning is local operator state. AI cannot pin or prevent deletion through MCP.

## 4. Stale-work detector

Introduce `CouncilStaleWorkMonitor`, driven by Council mutations plus a low-frequency repair timer.

A task is considered potentially stale only when all are true:

- status is `claimed`, `in_progress`, `review`, or `blocked`;
- it is assigned to a managed agent;
- its `updatedAt` exceeds the configured stale age;
- the assignee is not currently active;
- no equivalent active escalation exists;
- there is no newer Council task/message evidence showing intentional waiting.

Default stale ages:

- claimed/in_progress: 30 minutes;
- review: 20 minutes;
- blocked: 60 minutes.

The monitor does not reassign directly. It creates one durable `escalation` intent to the user-selected manager. The manager receives the stale task, health, candidate agents and relevant memory results, and can reassign/review/spawn using existing permission-gated Council actions.

The dedupe key includes task ID and task `updatedAt`, so one unchanged task revision creates at most one stale escalation.

## 5. Deterministic candidate hints

For manager escalations, Council computes safe candidate hints rather than silently assigning work.

Candidate scoring uses only deterministic local evidence:

- healthy/sleeping agent preferred over limited/signed-out/quarantined;
- fewer non-done assigned tasks preferred;
- role/mandate keyword overlap with task title/description;
- recent successful task completion in the same project;
- reviewer role boost for review work;
- current active agent penalty to avoid overload.

The result is advisory (`candidateHints`) in the manager prompt and operator UI. The manager remains the authority that emits reassignment/spawn actions.

## 6. Operator resolution for uncertain work

`SUBMISSION_UNCERTAIN` must remain stopped until the local operator chooses:

- **Acknowledge / leave stopped** — preserves audit and does not send anything.
- **Cancel** — marks the durable item cancelled.
- **Retry as a new intent** — explicit human action creates a new correlation/work item and records `operator-retry`; it never mutates the uncertain item back to queued.

The UI must show why automatic retry was disabled and the last persisted browser phase. No raw prompt body is shown because durable work does not store it.

Owner-only endpoints and IPC support these actions. MCP remains read-only for uncertain resolution.

## 7. Queue and health operator workspace

Electron adds an Autonomy view/panel with:

- active work item and queue counts by kind/state;
- retry-wait timers;
- uncertain/failed items;
- per-agent health and breaker cooldown;
- hourly budget utilization;
- recent audit timeline;
- stale-task escalations;
- safe operator actions only for terminal exceptional items.

The existing Chrome-like ChatGPT project tabs retain compact health badges, while detailed diagnostics live in this view.

## 8. Health anti-flapping

Extend the health ledger with a small stability rule:

- transient successful evidence closes connection/busy breakers immediately;
- `limited`, `signed-out`, and `quarantined` require explicit strong healthy evidence, not merely a parked-tab observation;
- repeated alternating healthy/error samples are retained in evidence and exposed as `flapping=true` after a bounded threshold;
- flapping agents are deprioritized in candidate hints but are not automatically quarantined.

## 9. Memory retention and privacy

Defaults:

- observation run limit remains compatible with 3.4 policy;
- evidence blob global budget: 512 MiB by default;
- memory entries: maximum 20,000 safe entries / 90 days;
- longitudinal digests: maximum 180 daily/project digests;
- audit retains its 3.5 10,000-event / 30-day bound.

Delete operations remove corresponding memory entries and rebuild affected digests. Clearing history removes observations, memory entries and unreferenced evidence blobs, but never deletes Council rooms/tasks/decisions or managed-agent private checkpoints unless a separate reset operation is explicitly requested.

## 10. Testing

Required tests:

- identical PNGs dedupe to one blob and refcounts survive restart;
- deleting one of two references preserves the blob; deleting the last removes it;
- memory search returns relevant bounded provenance and excludes forbidden private fields;
- deleting an observation removes its memory entries;
- stale unchanged task produces one escalation only;
- task update permits one new escalation revision;
- active agent is not stale-escalated;
- no selected manager means stale monitor records status but does not invent a manager;
- candidate hints exclude/open-breaker agents and prefer lower load/role overlap;
- uncertain work cannot be automatically retried;
- owner retry creates a new item/correlation and leaves original uncertain;
- Electron preload exposes operator controls only through IPC;
- full verify/package/smoke matrix remains green on macOS, Windows and Ubuntu.

## Acceptance

Council 3.6 is complete when long-running screenshot/history data deduplicates and remains user-deletable, AIs can retrieve bounded old project memory with provenance, stale tasks escalate exactly once per task revision, exceptional uncertain work is human-resolved only, and the operator can inspect durable queue/health/budget/history state without exposing private continuity data.
