# ChatGPT Council Design

## Goal
Transform `Nolane-x/codexweb` from a Codex-centric bridge into a local-first collaboration hub for multiple normal ChatGPT conversations while preserving the polished Electron UI, authenticated browser partition, browser worker, Secure MCP Tunnel plumbing, diagnostics, and useful continuity machinery.

## Architecture

### Council core
Owner-local state stores named agents, rooms, threaded messages, first-class proposals, final decisions, tasks, wake events, and compact private checkpoints. State mutations are bounded and atomically persisted.

### Council MCP
The active tunnel `mcp` entry exposes Council tools rather than the old Codex turn-broker surface. Every non-join call carries an explicit stable `agent_id`; no Council tool requires a Codex `turn_token` or transport-session identity.

### Deliberation
`council_propose` creates a first-class proposal thread; participants challenge it with `council_reply`; a Chair/agreed participant records the final policy, rationale, accepted/rejected arguments, and unresolved risks with `council_decide`; tasks are created only after/alongside deliberation.

### Wake engine
`council_wake` durably targets an `agent_id`. Council Full mode reuses `ChatGptBrowserWorker` to start a real ChatGPT Web resurrection turn with the exact `CodexWeb Council` connector. Wake delivery is serialized per target. The bounded packet restores identity, room mission, wake reason, personal checkpoint, recent relevant discussion, decisions, and active tasks. It never asks for or persists hidden chain-of-thought.

### Standalone product mode
Council setup restores/removes any previously managed Codex model route before saving Council configuration. Council runtime starts the Secure MCP Tunnel only; it does not start the old Responses daemon or require Codex model catalog routing. Large previous CLI/runtime implementations are preserved as `*-legacy` modules for migration/rollback.

### Human UI
The original `App.tsx` and `styles.css` remain untouched. `CouncilDock` is mounted additively and shows rooms/transcript/participants/wakes/tasks/decisions. `CouncilSetupPanel` gives Council its own connection path rather than requiring the old Codex setup wizard. The dashboard reads a loopback-only bounded HTTP snapshot; private checkpoints are excluded.

## Security invariants
- Stable IDs are authoritative at the Council protocol layer; identity is cooperative local identity, not cryptographic per-agent authentication.
- Wake never selects by tab order/title or simulated mouse/keyboard operations.
- State uses owner-local atomic writes and bounded payloads.
- MCP mutations remain explicit tool calls; no hidden shell execution is added.
- Dashboard HTTP binds `127.0.0.1`, rejects non-local browser origins, and excludes private checkpoints.
- Migration restores the managed Codex route fail-closed rather than leaving a hidden `openai_base_url` redirect.
- No access-control, confirmation, or product-usage-limit bypass is introduced.

## Acceptance criteria
1. Typed Council state/store covers identities, rooms, threaded messages/proposals, decisions, tasks, wakes, failures, and checkpoints.
2. Council MCP has no Codex `turn_token` dependency and exposes explicit proposal/reply/decision/task primitives.
3. Actor identity works independently of MCP transport session behavior.
4. Council setup restores old Codex routing and never installs a new route.
5. Council runtime starts the Secure MCP Tunnel without starting the Responses daemon.
6. Full mode can schedule a real ChatGPT Web resurrection turn through the existing browser worker and exact Council connector.
7. Wake delivery is serialized per target and persists attempt/failure state.
8. Existing `App.tsx`/`styles.css` stay intact; Council UI is additive and reuses the token system.
9. Council overlay hides/restores the external ChatGPT browser surface correctly.
10. Public dashboard snapshots exclude private checkpoints and reject non-local browser origins.
11. The old implementation remains available as legacy source until live usage justifies physical deletion.
12. Full release packaging/CI must be verified separately; unavailable CI evidence must never be represented as passing.
