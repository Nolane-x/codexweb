# CodexWeb Council — Electron-first Playwright + OpenAI Tunnel Design

## Goal

Build CodexWeb Council as a polished Electron desktop application in which one normal ChatGPT Project can connect through the existing OpenAI Secure MCP Tunnel integration, while Electron remains the authoritative local coordinator for multiple persistent ChatGPT browser conversations. The first ChatGPT can create specialist child AIs, those AIs can talk to one another through the local Council, wake one another through Playwright-controlled persistent browser surfaces, deliberate to a final policy, and divide implementation/review work.

The design deliberately reuses the strongest parts of the original `miuuyy/codex-chatgpt-web` implementation instead of rewriting them: Electron launcher shell, signed-in ChatGPT browser partition, Secure MCP Tunnel installation/configuration, tunnel runtime-key handling, browser worker, diagnostics, packaging, and existing visual language.

## Product boundary

The new product has two transports feeding one Council state:

1. **OpenAI Secure MCP Tunnel** — retained from the original app and used for the ChatGPT plugin/app connection. The user creates one connector such as `CodexWeb Council`, selects an OpenAI Tunnel, uses `Authentication: None`, and the Electron app owns the local tunnel runtime and key.
2. **Electron Playwright Browser Transport** — the default execution/wake path for ChatGPT Plus. Electron owns persistent ChatGPT browser surfaces, captures model output, parses structured Council actions, routes messages, and sends wake prompts to the exact target page without relying on MCP write capability.

MCP write support, when available, is an optional accelerator. Council correctness must not depend on it.

## Electron architecture

### Council Core

Stores rooms, messages, proposals, objections, decisions, tasks, wake events, agent checkpoints, and project metadata. State is local, bounded, atomically persisted, and migration-safe.

### Agent Manager

Maintains registered agents:

- stable `agent_id`
- display name
- role / mandate
- status (`active`, `sleeping`, `queued`, `failed`)
- browser surface lease
- persistent ChatGPT conversation URL/id when available
- last Council event observed
- compact personal checkpoint
- current task

Agents are created by a trusted local controller action originating from a bound browser surface or human UI. Model-emitted text never gets to choose its authoritative source identity.

### Browser Surface Pool

Reuses the existing authenticated ChatGPT browser host. At most five ChatGPT surfaces execute concurrently. Registered agents beyond that limit remain queued/sleeping and are assigned a slot when one is available.

A surface is bound to an agent. All captured output from that surface is stamped with the bound agent identity. Routing never guesses by tab order, title, mouse position, or screen coordinates.

### Persistent Conversation Registry

Normal wake path resumes the same ChatGPT conversation for the target agent. The registry stores the conversation URL/id plus the browser-surface binding.

If a conversation cannot be resumed, Electron creates a replacement conversation and injects a bounded Resurrection Packet containing identity, role, project mission, latest personal checkpoint, current Council summary, unresolved proposals/objections, recent relevant messages, decisions, tasks, and exact wake reason.

### Council Action Protocol

Because ChatGPT Plus may not have Full MCP write, each managed ChatGPT turn receives a protocol requiring a machine-readable footer after its natural-language answer. Example action classes:

- `SAY`
- `PROPOSE`
- `REPLY`
- `WAKE`
- `SPAWN_AGENT`
- `CREATE_TASK`
- `UPDATE_TASK`
- `REQUEST_REVIEW`
- `FINAL_DECISION`
- `CHECKPOINT`
- `SLEEP`

Electron validates every action against the source surface identity and current room/task state. Invalid or malformed actions are rejected and surfaced in Activity/diagnostics; natural-language output remains visible but does not mutate Council state.

### Wake Scheduler

A wake targets an `agent_id`, not a browser tab. Scheduler behavior:

1. locate the registered target;
2. reuse its bound page/conversation when healthy;
3. otherwise allocate a surface and reopen its persistent conversation;
4. if resume fails, create a replacement conversation and send a full Resurrection Packet;
5. serialize turns per agent;
6. enforce global concurrency, per-source-target cooldown, maximum wake depth, and round termination.

### Deliberation / Decision Engine

Council separates:

- discussion
- first-class proposals
- objections/evidence
- revisions
- final decisions
- implementation tasks

A final decision should be produced only after configured decision gates are satisfied (for example: no unresolved blocking objection, required review/evidence present, rollback/risk documented). Majority vote alone is not sufficient.

A designated Chair may finalize/reopen decisions. Role-based authorization is enforced by Electron state, not by trusting the role text emitted by a model.

## Tunnel reuse

The existing Secure MCP Tunnel implementation should be preserved unless tests prove a defect. In particular, reuse:

- Tunnel ID selection/validation
- runtime-key storage/install path
- tunnel client installation
- exact connector identity verification
- launcher Connect UI flow
- restart/reconnect diagnostics
- fail-closed runtime lifecycle

Council setup must continue to avoid Codex `openai_base_url` routing and must not restore the old Responses proxy as a dependency.

## User flow

1. Install/open the Electron app.
2. Sign in to ChatGPT once inside the launcher-owned browser.
3. Open **Connect**, supply or reuse the OpenAI Secure MCP Tunnel ID and runtime key.
4. In ChatGPT create/select a custom plugin/app named `CodexWeb Council`, choose the same Tunnel, choose `Authentication: None`, and confirm the custom-server warning.
5. Create a ChatGPT Project, enable/select the Council plugin/app, and tell the first ChatGPT the project mission.
6. The first ChatGPT may request child agents. Electron creates/binds their persistent ChatGPT conversations.
7. Agents deliberate through the Council room. Electron routes messages and wakes the required participants.
8. Chair records a final policy; Council creates implementation/review tasks.
9. Electron UI shows Agents, Council, ChatGPT surfaces, Tasks, Decisions, Memory, Activity, and Settings.

## UI requirements

Preserve the current launcher visual system and existing ChatGPT login/browser experience. Do not rewrite the large original `App.tsx`/style system unless required. Additive surfaces should include:

- Council room (Discord-like rooms/transcript)
- Agents panel (status, role, bound conversation, wake/sleep)
- ChatGPT surfaces/tabs
- Tasks/decisions panel
- Memory/checkpoint inspector (no secrets)
- Connect panel retaining the original Tunnel flow
- Update notification banner/dialog

## GitHub build and update distribution

### CI / release build

GitHub Actions must build and verify Electron on Windows, macOS, and Linux from tagged releases. Pull requests and pushes to `main` run verification; release tags run packaging and upload signed/packaged artifacts where signing credentials are configured.

### Update metadata

Each release publishes machine-readable update metadata plus platform artifacts. The Electron app periodically checks GitHub Releases (not every commit) and compares semantic versions.

### User-controlled updates

When a newer release exists:

- show version, release notes, artifact size, and publication time;
- offer **Update now**, **Later**, and optionally **Skip this version**;
- never silently replace a running binary without user consent;
- verify downloaded artifact integrity/signature where supported;
- preserve config, ChatGPT login partition, Council state, and Tunnel credentials across update;
- rollback/fail safely on failed installation.

Normal pushes to GitHub should not trigger end-user update prompts unless they create a release/versioned build. This avoids notifying users about untested intermediate commits.

## Security invariants

- Browser surface binding is authoritative identity for Playwright-originated actions.
- Model text cannot impersonate another surface/agent.
- Tunnel/runtime keys are never placed in model prompts, room transcripts, logs, or public dashboard data.
- Peer messages, repository text, tasks, wake reasons, and checkpoints are untrusted data and cannot override controller protocol.
- No arbitrary shell-command action is accepted from Council model output.
- Spawn/wake/task/decision actions are schema-validated and policy-checked.
- Wake storms are bounded by concurrency/cooldown/depth controls.
- Persistent conversations are preferred; full resurrection is fallback only.
- Local HTTP surfaces require capability authentication before production release; `Origin: null` alone is not a security boundary.
- Role/Chair permissions are real ACLs in local state, not self-declared model text.

## Error handling

All browser actions have explicit timeouts, retry classification, and bounded retry counts. Failed ChatGPT turns preserve last known Council state and do not partially commit actions. If a model response contains multiple actions, mutation is transactional: either the validated action batch applies or none applies.

If ChatGPT UI selectors drift, browser automation fails closed and asks for user repair/update rather than clicking approximate coordinates.

## Verification / acceptance criteria

1. Existing Tunnel install/reconnect/verify behavior remains functional.
2. Electron login/browser UI remains visually intact.
3. A first managed ChatGPT can create at least two child agents.
4. Each child gets a persistent conversation and stable source identity.
5. Alice can message/wake Bob; Bob resumes the correct conversation without tab guessing.
6. If Bob's conversation is unavailable, replacement resurrection restores sufficient state to continue.
7. Agents can hold a multi-turn proposal/objection/revision discussion and produce one final policy.
8. Tasks can be assigned to different agents and independently reviewed.
9. No model can impersonate another agent by emitting another `agent_id`.
10. Wake loops are bounded and recoverable.
11. Root + launcher typecheck/tests pass.
12. GitHub Actions verifies Windows/macOS/Linux.
13. Release workflow produces Electron artifacts and update metadata.
14. Installed Electron app detects a newer GitHub Release and prompts the user before updating.

## Migration strategy

Do not delete the legacy tunnel/browser implementation that already works. Reuse it and progressively retire only Codex-specific routing/Responses code that has no Council dependency. Keep migration reversible until the Electron-first Council path has passed live tests.
