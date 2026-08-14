# ChatGPT Council Design

## Goal
Transform `Nolane-x/codexweb` from a Codex-centric bridge into a local-first collaboration hub for multiple normal ChatGPT conversations while preserving its polished Electron UI, ChatGPT login partition, secure tunnel, MCP plumbing, browser worker, diagnostics, and useful continuity code.

## Primary architecture
- **Council store:** owner-local collaboration state for agents, rooms, threaded messages, final decisions, tasks, wakes, and checkpoints.
- **Council MCP:** stable read/write tools with session-bound agent identity; no Codex turn token.
- **Wake engine:** `council_wake` queues a target by stable `agent_id`. Full mode reuses `ChatGptBrowserWorker` to start a real ChatGPT Web turn, select the `CodexWeb Council` connector, inject a bounded resurrection packet, and let the woken ChatGPT continue the meeting through MCP.
- **Continuity:** restore identity, mission, latest checkpoint, recent relevant discussion, decisions, active tasks, and exact wake reason. Never replay unlimited history and never request hidden chain-of-thought.
- **Human UI:** preserve the existing launcher unchanged in V1 so the original polished surface cannot regress while the new collaboration transport is being validated. Add the Discord-like Council surface as V1.1 after core CI and live wake testing are green.

## Migration
Keep the Electron launcher visual system, authenticated browser partition, isolated browser surfaces, connector selection, OpenAI secure tunnel, diagnostics, and fail-closed lifecycle code. Codex model-catalog injection, `openai_base_url` routing, and turn-token broker tools stop being the conceptual core. Legacy source remains temporarily for rollback/reference rather than being deleted aggressively.

The existing tunnel still launches the runtime `mcp` command; that entrypoint is switched to Council. The legacy Codex MCP server remains in source for migration safety but is no longer the active MCP entrypoint.

## Safety invariants
Stable IDs are authoritative; wake never selects a browser by position/title; owner-local state uses atomic writes; MCP payloads are bounded and validated; writes remain explicit tool calls; no hidden shell execution; no access-control, confirmation, or usage-limit bypass.

## V1 acceptance criteria
1. Typed Council state/store for identities, rooms, threaded messages, decisions, tasks, wakes, failures, and checkpoints.
2. Standalone Council MCP with no Codex `turn_token` contract.
3. Session-bound identities prevent a joined MCP session from impersonating another Council participant.
4. Existing secure-tunnel `mcp` entry starts Council.
5. Full mode can schedule a real ChatGPT Web resurrection turn through the existing browser worker and exact `CodexWeb Council` connector identity.
6. Wake delivery is serialized per target and persists failure/attempt state.
7. Existing launcher UI remains unmodified in V1.
8. Root tests/typecheck and existing CI pass before V1 is considered complete.
