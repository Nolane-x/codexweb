# CodexWeb Council 3.0

**A local-first Electron control center where normal ChatGPT conversations can form a team, deliberate, wake one another, reach a final policy, divide work, and keep persistent conversational state.**

CodexWeb Council keeps the strongest infrastructure from `miuuyy/codex-chatgpt-web`—the polished Electron launcher, persistent ChatGPT login/browser partition, Secure MCP Tunnel setup, browser worker, diagnostics, packaging, and updater—but replaces Codex model routing as the product core with a ChatGPT Council.

> Status: experimental research software. The Electron-first Council path is implemented and verified on Linux with the repository's full `bun run verify`, Electron packaging, and packaged-app smoke tests. macOS/Windows packaging remains gated by GitHub Actions on this fork.

## Architecture

```text
Normal ChatGPT Project / Lead
          │
          ├── OpenAI Secure MCP Tunnel ── Council MCP (when the account/workspace permits it)
          │
          └── Electron owner fallback ─── current persistent ChatGPT conversation
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────┐
│                  CODEXWEB ELECTRON                      │
│                                                         │
│  ChatGPT login/browser host     Local Council state     │
│            │                    rooms / policy / tasks   │
│            └──────────────┬───────────────┘             │
│                           ▼                             │
│                  Managed Agent Runtime                  │
│                           │                             │
│          ┌────────────────┼────────────────┐            │
│          ▼                ▼                ▼            │
│       Alice            Bob             Carol           │
│     Architect         Critic           Builder          │
│          │                │                │            │
│     persistent normal ChatGPT conversation URLs         │
│          └──────────── Playwright ──────────┘            │
└─────────────────────────────────────────────────────────┘
```

### Two transports, one Council state

- **Secure MCP Tunnel** stays compatible with the old launcher flow. Create the ChatGPT plugin/app named exactly `CodexWeb Council`, choose **Tunnel**, choose the same OpenAI Secure MCP Tunnel, and use the authentication mode supported by your workspace.
- **Electron + Playwright** is the authoritative child-agent transport. Child identity is assigned by Electron browser binding, not by model text. Persistent `https://chatgpt.com/c/...` conversations are resumed on later wakes.
- **Plus fallback:** if a Plus workspace exposes the Tunnel/plugin UI but does not permit MCP write actions, open the intended persistent Project conversation inside the Electron ChatGPT browser and use **Agents → Bind current ChatGPT as Lead**. Electron reads the current conversation URL itself; the renderer cannot supply an arbitrary URL or agent identity.

## Deliberation protocol

A normal managed round is:

```text
Lead/Architect -> explicit proposal
Critic         -> independent threaded objection
Researcher     -> evidence / repository finding
Architect      -> revision
Chair          -> final policy
Lead           -> assigned tasks
Reviewer       -> review / request changes
```

Final policy is not a majority-vote shortcut. Managed finalization requires:

1. an explicit proposal;
2. when more than one participant is involved, at least one independent reply from another participant in the latest proposal thread;
3. no blocked task in the room; and
4. no pending/delivering wake or review request.

The final decision stores policy, rationale, accepted/rejected arguments, and unresolved risks.

## Persistent agents

Electron stores private managed-agent state separately from the public Council transcript:

- stable agent id, name, role and mandate;
- controller-owned permissions;
- persistent ChatGPT conversation URL;
- compact private checkpoint;
- runtime presence.

The launcher still caps active browser surfaces at **5**. Sleeping agents keep their conversation URL but release the physical browser surface, so the team can contain more registered agents without unbounded simultaneous ChatGPT traffic.

### Managed permissions

Managed roles use controller-side capabilities rather than trusting role text:

- `spawn`
- `finalize`
- `reopen`
- `assign`
- `wake`
- `review`

The same authorization is enforced whether the action arrives through MCP or through the Playwright action footer. A model cannot elevate itself by emitting another `agent_id` or permission field.

## Browser action footer

Electron-managed child responses end with exactly one terminal action block:

```text
<COUNCIL_ACTIONS version="1">
{"actions":[{"type":"PROPOSE","room_id":"project","body":"..."}]}
</COUNCIL_ACTIONS>
```

The parser is strict and bounded. Unknown fields, malformed JSON, source identity overrides, oversized payloads, and invalid action batches are rejected. Council-state mutations are staged in an in-memory transaction and persisted once; a failed action rolls the whole Council batch back. Browser side effects such as wake/spawn run only after the Council-state commit succeeds.

## Wake and resurrection

For a sleeping managed agent:

1. Electron resolves the stable agent binding.
2. Playwright opens/resumes the exact saved `chatgpt.com/c/...` conversation.
3. Only a verified unavailable/deleted conversation triggers a new conversation.
4. Generic network/send errors never trigger resurrection, avoiding duplicate work.
5. A compact resurrection packet includes identity, mandate, checkpoint, recent discussion, decisions, active work and wake reason.
6. Peer-authored data is isolated as untrusted context.

Wake loops are bounded by queue limits, cooldowns, per-target serialization, a maximum wake/spawn depth, and the five-surface browser cap.

## Electron UI

The original polished launcher remains the base UI. Council is additive:

- **Council**: rooms, transcript, proposals, participants, wake queue, tasks, decisions.
- **Agents**: managed project, Lead, child AI roles/mandates, runtime status and exact currently bound ChatGPT tabs.
- **Connect**: the preserved Secure MCP Tunnel setup/verification flow.
- **Updates**: verified release notification with **Update now / Later / Skip this version**.

The renderer never receives managed conversation URLs, private checkpoints, capability tokens, or the owner-control token.

## Setup

### Development

Requirements:

- Bun `1.3.14`
- a ChatGPT account usable in the launcher browser

```bash
bun install --frozen-lockfile
cd launcher
bun install --frozen-lockfile
cd ..

bun run verify
bun run app
```

### Secure MCP Tunnel / plugin

1. Open the Electron launcher and sign in to ChatGPT in its browser.
2. Open **Connect**.
3. Configure/reconnect the existing OpenAI Secure MCP Tunnel using the Tunnel ID and the runtime credential expected by the original launcher flow.
4. In ChatGPT create a new custom plugin/app named exactly:

```text
CodexWeb Council
```

5. Select **Tunnel** and choose the same Tunnel.
6. Select the authentication mode supported by your ChatGPT workspace; the old Council setup is designed for the no-extra-OAuth Tunnel flow.
7. Press **Verify Council connector** in Electron.

If your Plus workspace cannot execute Council write actions, use the Electron Plus fallback described above. The child agents themselves do not depend on MCP write access.

## First Lead flow

When MCP write actions are available, the first authenticated participant can call:

```text
council_join
council_start_project
council_spawn_agent
```

Only the earliest Council participant may bootstrap the managed project Lead. Once a managed project exists, another participant cannot replace it.

When MCP writes are unavailable:

1. navigate the Electron ChatGPT browser to the persistent conversation you want as Lead;
2. open **Agents**;
3. press **Bind current ChatGPT as Lead**;
4. Electron validates the current URL itself and wakes that same conversation with a bootstrap instruction to form the team.

## Council MCP tools

The Council MCP surface includes:

```text
council_join
council_room_upsert
council_status
council_read
council_say
council_propose
council_reply
council_decide
council_task_create
council_task_update
council_wake
council_checkpoint
council_context
council_agent_status
council_start_project
council_spawn_agent
council_managed_status
```

The legacy Codex turn-token broker is not the active Council MCP product path.

## Updates and GitHub builds

The repository keeps the original multi-platform packaging pipeline and updater security model.

- Pull requests and `main` run the verify/package/smoke CI workflow when GitHub Actions is enabled for the fork.
- CI retains verified Electron packages as short-lived GitHub Actions artifacts.
- Stable releases are created only from version tags such as `v3.0.0` after the four-platform release workflow passes.
- The Electron updater is pinned to `Nolane-x/codexweb` release assets.
- Release asset URLs are path-pinned to GitHub HTTPS and downloads are SHA-256 checked against `checksums.txt` before installation.
- Installed users choose whether to update; no silent install is introduced.

Do **not** tag a release until the GitHub Actions build has passed on macOS ARM64/x64, Linux x64 and Windows x64.

## Verification

Current local Linux verification for the Electron-first branch uses the exact repository pipeline:

```bash
bun run verify
bun run app:package
bun run app:smoke
bun audit
cd launcher && bun audit
```

GitHub Actions on this fork must also be enabled before treating macOS/Windows release packaging as verified.

## Security model

Important boundaries:

- shared Council state and private managed state are owner-local and atomically written;
- per-agent MCP capabilities are not exposed through the dashboard;
- Electron browser binding is authoritative for Playwright child identity;
- managed ACLs apply to both MCP and browser action paths;
- owner fallback uses a random bearer capability stored in a mode-`0600` local descriptor and rejects browser-origin owner-control requests;
- private owner requests are loopback-only, redirect-disabled and timeout-bounded;
- persistent conversation URLs and checkpoints never enter the renderer/public snapshot;
- update downloads are repository/path/HTTPS/checksum pinned;
- no hidden shell execution or arbitrary command action exists in the Council browser protocol.

The read-only human dashboard is loopback-only but intentionally permits the packaged Electron `file://` renderer (`Origin: null`). It contains no capability tokens or private checkpoints; nevertheless, another hostile process or local file context running as the same OS user remains outside the current hardened multi-tenant threat model.

See `docs/council.md` and the design/implementation documents under `docs/superpowers/` for deeper protocol details.

## Lineage and license

CodexWeb Council is an independent fork/rework of [`miuuyy/codex-chatgpt-web`](https://github.com/miuuyy/codex-chatgpt-web). Retained portions remain under their existing MIT/license notices. This project is unofficial and is not affiliated with or endorsed by OpenAI.
