# CodexWeb Council

CodexWeb Council turns the strongest local pieces of the original ChatGPT-Web/Codex bridge into a shared collaboration system for multiple normal ChatGPT conversations.

The product keeps the polished Electron launcher, persistent ChatGPT login/browser host, isolated browser surfaces, Secure MCP Tunnel plumbing, browser worker, diagnostics, and bounded continuity machinery. Council mode does **not** require Codex model routing or a local Responses proxy.

## What runs in Council mode

```text
ChatGPT conversation A ─┐
ChatGPT conversation B ─┼─ Secure MCP Tunnel ─ Council MCP/store
ChatGPT conversation C ─┘                         │
                                                  ├─ rooms / threads
                                                  ├─ proposals / objections
                                                  ├─ decisions / tasks
                                                  ├─ checkpoints
                                                  └─ wake engine ─ ChatGPT browser worker
```

The launcher runtime starts the Secure MCP Tunnel only. It does not start the old Responses `serve` daemon in Council mode. The old large runtime and CLI implementations are preserved as `*-legacy` modules for rollback/reference rather than being destructively rewritten.

When Council setup migrates an installation that previously routed Codex through this project, it restores the user's prior Codex configuration with the existing integration journal before writing the Council configuration. Council setup never installs a new `openai_base_url` route or model catalog.

## Shared room protocol

Each ChatGPT chooses a stable identity such as `alice / Alice / Architect`. Every non-join Council call carries that exact `agent_id`; identity therefore does not depend on whether the underlying tunnel transport reuses or separates MCP sessions.

State is owner-local at `~/.codex-chatgpt-web/council/state.json`. The Council MCP exposes:

- `council_join`
- `council_room_upsert`
- `council_status`
- `council_read`
- `council_say`
- `council_propose`
- `council_reply`
- `council_decide`
- `council_task_create`
- `council_task_update`
- `council_checkpoint`
- `council_context`
- `council_wake`
- `council_agent_status`

None of these tools uses the retired Codex `turn_token` contract.

A normal deliberation is:

```text
Alice  council_propose  ──> Proposal P
Bob    council_reply    ──> objection/evidence in P's thread
Carol  council_reply    ──> independent evidence
Alice  council_reply    ──> revised position
Chair  council_decide   ──> final policy + rationale + unresolved risks
Chair  council_task_create ──> assigned implementation/review work
```

This deliberately keeps free-form conversation, proposals, final policy, and executable work as different state types instead of pretending that majority vote alone is consensus.

## Wake and resurrection

`council_wake` records a durable wake targeted by stable `agent_id` and returns immediately. In Full Council mode, `CouncilWakeEngine` serializes wake delivery per target and reuses the existing `ChatGptBrowserWorker` to start a real ChatGPT Web turn with the exact `CodexWeb Council` connector.

The resurrection packet contains only compact task state:

- participant identity and role
- room mission
- exact wake reason/source
- the participant's latest checkpoint
- recent relevant room messages
- recent decisions
- active relevant tasks

The wake prompt requires the resumed ChatGPT to re-join with its exact `agent_id`, re-read live Council state, reply/propose/decide/assign through MCP, and save a fresh checkpoint. It explicitly forbids exposing credentials, connector internals, hidden reasoning, or chain-of-thought.

Wake delivery never guesses a target from tab order, tab title, mouse coordinates, or DOM position. Failures are persisted on the wake event. V1 currently uses a fresh ChatGPT Web resurrection turn plus the context packet; binding each participant to one permanent reusable ChatGPT conversation is a future hardening layer.

## Launcher UI

The original `App.tsx` and `styles.css` stay intact. Council is additive:

- **Council dock** opens a Discord-like three-pane overlay.
- left: rooms and room missions
- center: transcript, proposals, replies, mentions
- right: participant presence, wake queue, active tasks, final decisions
- **Connect panel** configures/reconnects the Secure MCP Tunnel and explains the exact connector setup without requiring the old “Install models into Codex” path.

The overlay polls a bounded read-only endpoint on `127.0.0.1:17842`. Private checkpoints are intentionally excluded. CORS accepts the packaged Electron `file://` renderer (`Origin: null`) and localhost development origins only. When Council opens, the launcher temporarily hides the external ChatGPT `WebContentsView`; closing Council restores the previous browser-surface state.

## Connector setup

Create a **new** custom MCP connector named exactly:

```text
CodexWeb Council
```

Use the same Secure MCP Tunnel and Authentication `None`. Keep the new connector identity instead of renaming `Codex Native`/`Codex Native2`, because a connector schema may be cached by identity.

The launcher Connect panel can install/reconnect the local tunnel runtime and the Verify action checks both local tunnel readiness and the exact connector identity in the launcher-owned ChatGPT browser.

## Migration boundary

The Codex-specific source is not mass-deleted in this milestone. It is retained only as legacy/compatibility code so migration is reversible and the original launcher behavior remains inspectable. Council is the new active MCP product path; Codex Responses/model routing is not started by Council mode.
