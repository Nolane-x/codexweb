# CodexWeb Council

CodexWeb Council repurposes the strongest local pieces of `codex-chatgpt-web` into a shared collaboration layer for multiple normal ChatGPT conversations.

The existing Electron login/browser host, secure tunnel, connector selection, diagnostics, and browser worker remain. The `mcp` tunnel entry now exposes Council tools instead of the legacy Codex turn-broker tool surface.

## Shared room model
Each ChatGPT joins with a stable identity such as `alice / Alice / Architect`, then uses one shared transcript plus structured decisions/tasks. State is owner-local at `~/.codex-chatgpt-web/council/state.json`.

Council tools: `council_join`, `council_room_upsert`, `council_status`, `council_read`, `council_say`, `council_reply`, `council_decide`, `council_task_create`, `council_task_update`, `council_checkpoint`, `council_context`, `council_wake`, and `council_agent_status`. Council tools do not use the old Codex `turn_token` contract.

## Real wake/resurrection flow
In Full MCP/tunnel mode, `council_wake` records a durable wake and queues `CouncilWakeEngine`. The engine targets a stable `agent_id`, reuses the existing `ChatGptBrowserWorker`, selects the exact `CodexWeb Council` connector, and injects identity + room mission + personal checkpoint + recent discussion + decisions + active tasks + wake reason. The woken ChatGPT is instructed to join, re-read current Council state, speak/reply/decide/assign through MCP, and save a new checkpoint.

Wake scheduling is serialized per target agent. It never guesses a target by tab order, title, or mouse coordinates. Delivery failure is persisted with status/error. The restoration packet shares conclusions/evidence/work state only and never asks for hidden chain-of-thought.

## Connector identity
Create a new ChatGPT connector named exactly `CodexWeb Council`. The browser worker selects it by exact name. A new identity matters because ChatGPT may cache an MCP schema by connector identity; do not reuse the old `Codex Native` / `Codex Native2` identity after changing the contract.

The existing secure-tunnel plumbing can still launch the local `mcp` command. During migration, `mcp --broker-socket ...` is accepted for launcher compatibility but the Council server ignores the retired broker path.

## Migration boundary
V1 intentionally does not delete the old Codex bridge source. The tunnel entry is switched to Council while legacy source remains for comparison/rollback until Council has passed CI and real use. The existing launcher UI is preserved unchanged in this milestone; the Council room UI is the next integration step after the core is green.
