# CodexWeb Council 3.0 protocol

## Product boundary

Council 3.0 is Electron-first. The OpenAI Secure MCP Tunnel is preserved as the plugin/app connection layer, while Electron + Playwright is the authoritative transport for managed child ChatGPT conversations.

```text
ChatGPT Project Lead
  ├─ Secure MCP Tunnel -> Council MCP
  └─ Electron owner fallback (Plus/no MCP-write)
                     |
                     v
              Managed Council
        rooms / policy / tasks / memory
                     |
          Electron Agent Manager
             /      |       \
         Alice     Bob      Carol
          normal persistent ChatGPT chats
```

No child identity is inferred from tab title/order, mouse position, or model-supplied `agent_id`. Electron assigns a stable binding key and routes to the corresponding browser surface/conversation.

## Project bootstrap

There is one active managed project per Electron instance in v3.0.

### MCP path

1. First ChatGPT calls `council_join` and keeps the returned `agent_token` private.
2. The earliest joined participant calls `council_start_project`.
3. It becomes Lead with controller-side permissions.
4. Lead may call `council_spawn_agent` with a subset of its own permissions.

A later participant cannot take over the active project.

### Plus / no-write fallback

1. User opens the intended persistent Project conversation inside the Electron ChatGPT browser.
2. User presses **Agents -> Bind current ChatGPT as Lead**.
3. Electron main process—not the renderer—reads the current `https://chatgpt.com/c/...` URL.
4. Electron calls a bearer-authenticated owner-control endpoint on `127.0.0.1`.
5. Runtime binds that exact conversation to Lead and schedules a bootstrap turn.

The owner-control bearer token is random, stored in a mode-`0600` descriptor, not exposed to renderer state, and rotated whenever the Council runtime starts.

## Managed agent state

Private managed state contains:

- id/name/role/mandate;
- permissions;
- persistent conversation URL;
- compact checkpoint.

Runtime surface leases are not persisted across Electron restart. The conversation URL is the durable continuity identity.

The human dashboard receives only sanitized metadata: whether a conversation/checkpoint exists and current runtime status. It never receives the URL/checkpoint/token.

## Active surface policy

The original browser safety cap remains **5 simultaneous surfaces**.

A sleeping agent releases its physical surface but retains its conversation URL. A later wake allocates/reuses a surface and navigates to the exact saved conversation.

A generic navigation/network/send error is not proof that a conversation disappeared. Only explicit unavailable/deleted evidence permits resurrection into a new conversation; this prevents duplicated work.

## Browser response protocol

Every managed browser turn ends with exactly one terminal block:

```text
<COUNCIL_ACTIONS version="1">
{"actions":[...]}
</COUNCIL_ACTIONS>
```

Supported actions:

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

The parser rejects unknown fields, malformed or oversized JSON, more than 16 actions, multiple terminal blocks, model-supplied source identity, and invalid action combinations.

## Atomic action application

The entire Council-state part of one browser action batch is validated before execution and then run inside `CouncilStore.transaction`:

1. clone current state;
2. apply all Council mutations to the draft;
3. persist once with the existing atomic state-file writer;
4. on any validation/persist failure restore original memory/disk state;
5. only after commit run external effects such as Playwright wake/spawn.

This prevents half-applied batches such as "message saved but task/review failed".

## Permissions

Managed permissions are controller state, not descriptive role strings:

- `spawn`
- `finalize`
- `reopen`
- `assign`
- `wake`
- `review`

The same ACL is enforced on both Playwright action batches and MCP mutations. A managed Critic therefore cannot bypass its browser restrictions by directly invoking `council_decide` through the Tunnel.

## Decision gate

For managed final policy, `finalize` permission alone is insufficient.

The room must have:

1. at least one explicit proposal;
2. if another participant is involved, at least one independent reply from a different participant in the latest proposal thread;
3. zero blocked tasks; and
4. zero pending/delivering wake/review requests.

The decision then records policy, rationale, accepted/rejected arguments, and unresolved risks.

## Wake flow

A managed wake is durable in Council state and then routed by `HybridCouncilWakeDelivery`:

- managed target -> persistent Electron/Playwright agent;
- legacy/unmanaged target -> old browser wake engine when available;
- no delivery transport -> wake remains pending.

Managed wake delivery is serialized per target and additionally bounded by the existing cooldown/queue limits and a max spawn/wake depth.

## Resurrection packet

Only when a persistent conversation is unavailable does the runtime build a full packet containing:

- stable identity and mandate;
- room/project mission;
- wake reason;
- private checkpoint;
- recent relevant messages;
- decisions;
- active tasks;
- allowed action protocol.

Peer-authored text is isolated as untrusted collaboration data. Hidden chain-of-thought is neither requested nor stored.

## Tunnel compatibility

The old launcher Tunnel plumbing remains active. Council setup does not restore Codex model routing or start the old Responses proxy. The Tunnel starts the Council MCP entrypoint.

Create the ChatGPT plugin/app with exact identity:

```text
CodexWeb Council
```

Select the same OpenAI Secure MCP Tunnel and the authentication mode supported by the workspace.

## Electron update path

- PR/main CI verifies, packages, smokes, and retains short-lived Electron artifacts when GitHub Actions is enabled.
- Tagged stable releases use the existing four-platform release workflow.
- Electron checks `Nolane-x/codexweb` latest release.
- Asset URL is HTTPS/path-pinned.
- SHA-256 must match `checksums.txt` before installation.
- User explicitly chooses **Update now**, **Later**, or **Skip this version**.

No commit-to-user silent update is introduced.

## Security boundaries

- Council MCP per-agent capabilities remain private.
- Managed Playwright identity is Electron binding, not model text.
- Managed MCP and browser transports share ACLs.
- Owner fallback is loopback + private bearer + no browser Origin + redirect-disabled Electron client.
- Public dashboard excludes credentials, conversation URLs, and private checkpoints.
- No Council browser action maps to arbitrary shell execution.
- Local same-OS-user compromise is outside the current multi-tenant security boundary; the dashboard remains intentionally local-owner software.
