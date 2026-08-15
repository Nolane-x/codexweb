# Council 3.6 Memory, Operator, and Team Policy — Implementation Plan

Base: `council-3.6-memory-operator-policy` from Council 3.5 durable autonomy.

## Gate 1 — Evidence blob store

1. Add `src/council/evidence-store.ts` with private atomic manifest, SHA-256 PNG blobs, refcounting, restart validation, GC and byte/count statistics.
2. Add unit tests for dedupe, restart, refcount-safe deletion, budget pruning and corrupt manifest quarantine.
3. Integrate observation screenshot writes/reads/deletes through the evidence store while preserving compatibility with existing observation screenshot IDs and lazy migration of legacy PNGs.

## Gate 2 — Memory index

1. Add `src/council/memory-index.ts` with bounded safe provenance entries and deterministic lexical+recency search.
2. Add projection adapters for observation completion/deletion, decisions, tasks and safe autonomy audit summaries.
3. Add `council_memory_search` and `council_memory_recent` authenticated read-only MCP tools.
4. Add tests proving bounded results, provenance, deletion propagation and forbidden-field exclusion.

## Gate 3 — Stale-work monitor and candidate hints

1. Add `src/council/stale-work-monitor.ts` with mutation subscription + repair timer and status-specific stale thresholds.
2. Add `src/council/candidate-hints.ts` deterministic scoring from health/load/role/task history.
3. Route stale task revisions to exactly one durable manager escalation; no direct reassignment.
4. Extend manager escalation context with candidate hints and relevant memory.
5. Add tests for idempotence, new task revisions, active-agent suppression, breaker exclusions and role/load preference.

## Gate 4 — Exceptional work operator controls

1. Extend durable work store with safe public exceptional-item summaries and explicit operator-only `cancelTerminal` / `retryUncertainAsNew` primitives.
2. Add owner loopback endpoints for listing exceptional work, cancelling eligible items and explicit new-intent retry.
3. Add Electron main-process IPC and preload methods; no owner token exposure to renderer.
4. Add regression tests proving uncertain work never returns to queued automatically and operator retry creates a new ID/correlation while preserving original audit.

## Gate 5 — Operator workspace and historical data UI

1. Add Autonomy/Memory UI surfaces to the Council Electron renderer.
2. Show active queue, retry timers, exceptional work, per-agent health/breakers, budget use, audit timeline, stale escalations and storage/dedupe metrics.
3. Expand retained observation search/filter/delete and important-history pin state through owner-only APIs.
4. Keep project ChatGPT tabs compact; use detailed diagnostics in the operator panel.
5. Add renderer contract tests for safe IPC-only owner operations.

## Gate 6 — Health stability

1. Add bounded flapping detection to agent health without weakening `limited`, `signed-out`, or `quarantined` breaker semantics.
2. Surface safe `flapping` state in candidate hints/status/UI.
3. Add tests for alternating failures/successes and strong-evidence breaker closure.

## Gate 7 — Migration and release

1. Preserve Council 3.4/3.5 observation files and lazily import legacy screenshot PNGs when accessed/compacted.
2. Bump runtime/launcher to 3.6.0 and add `docs/releases/3.6.0.md`.
3. Update Council architecture/user documentation for memory search, operator resolution and stale escalation.

## Gate 8 — Verification and integration

1. Run the full repository `bun run verify` suite through CI.
2. Require launcher package and packaged smoke success on macOS, Ubuntu and Windows.
3. Review diff for private data leakage, unsafe retry, browser concurrency, deletion correctness and migration safety.
4. Mark PR ready and squash merge only after the latest head is green.
