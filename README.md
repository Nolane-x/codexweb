# CodexWeb Council 4.1

**A standalone Electron-first mission control where persistent ChatGPT conversations can operate as a managed AI team with durable collaboration, typed execution telemetry, auditable operator actions, and fail-closed browser automation.**

## What changed in 4.1

Council 4.1 turns the browser automation layer into an explicit, observable **Execution Control Plane** instead of treating Playwright work as an opaque side effect.

- **Mission Control** is now the single desktop navigation authority. Overview, ChatGPT, Agents, Work, Memory, Executions, Connections, Diagnostics, and Settings live in one shell rather than overlapping legacy panels.
- **Persistent managed conversations** are independent from ephemeral browser surfaces. Saved or parked agents remain selectable and can reacquire the exact controller-owned ChatGPT conversation without sending a new prompt.
- **Deep State telemetry** distinguishes queued, thinking, deep-thinking, streaming, tool-running, waiting-user, completing, completed, rate-limited, conversation-limited, connection-lost, stalled, failed, and DOM-drift conditions.
- **Execution Control Plane** gives each managed browser operation a stable run identity, bounded event history, retry-safety classification, cancellation authority, and immutable operator receipts.
- **Retry is mechanically fail-closed.** Automatic or ordinary retry is permitted only before `submit-started`; ambiguous post-submit work becomes `uncertain` and requires operator resolution rather than replay.
- **MCP 1.8** adds focused execution inspection and control tools while preserving the existing Council collaboration surface. Raw browser URLs, DOM selectors, scripts, prompts, cookies, tokens, checkpoints, and hidden reasoning are never exposed.
- **Trusted Electron operator API** exposes bounded list/read/events/receipts/cancel/focus/capture/retry operations through the owner-only loopback authority. Renderer code never receives the owner bearer or private conversation URL.
- **Connection Truth Model** separates Tunnel, Council runtime, MCP server, optional ChatGPT connector, Playwright control, and ChatGPT session state instead of collapsing them into one misleading online/offline flag.
- **Optional connector policy** means the `CodexWeb Council` ChatGPT connector enhances the system when available but is not a prerequisite for the browser-only Council path.
- **DecisionGate v2** requires independent critique of the latest proposal when another participant is involved, preventing a multi-agent Council from finalizing by effectively agreeing with itself.
- **Release safety** now treats an already-published package version as a clean no-op, while a genuinely new version still runs the complete native build/publish pipeline.

## Council 4.1 execution model

```text
Mission Control / MCP / Electron owner API
                  │
                  │ typed commands + public telemetry
                  ▼
        CouncilExecutionControlPlane
        ┌─────────┼──────────┐
        │         │          │
     run state   events   command receipts
        │
        ▼
 CouncilBrowserTransport
        │
        ▼
 Playwright + Deep State Engine
        │
        ▼
 persistent ChatGPT conversations
```

The control plane is the single authority for public execution truth. Renderer UI, MCP tools, and owner operations consume that same model rather than maintaining independent clocks or retry state.

## ChatGPT Plus flow

1. Open the Electron app and sign in to ChatGPT in its browser.
2. Open **Connections** and reconnect your saved OpenAI Secure MCP Tunnel, or enter the Tunnel ID plus Tunnels Read + Use key once.
3. Open the persistent ChatGPT Project conversation you want as the coordinator.
4. Open **Agents** and choose **Bind current ChatGPT as Lead**.
5. Electron validates the actual `https://chatgpt.com/c/...` conversation itself and sends the Council bootstrap into that same conversation.
6. Lead can create specialist child AI conversations, request critique, wake them, assign work, and resume their persistent chats later.
7. Open **Executions** to inspect live browser runs, Deep State, retry safety, bounded events, and immutable operator receipts.

The Plus browser path uses Electron + Playwright for AI-to-AI writes. It does not require Plus to expose Full MCP write actions.

## Optional ChatGPT connector

If the ChatGPT workspace exposes custom MCP capabilities, create a connector named exactly:

```text
CodexWeb Council
```

Use the same Secure MCP Tunnel and the authentication mode supported by the workspace. Connector absence is treated as capability degradation, not as a fatal failure of the Council runtime.

## Security boundaries

- Electron assigns managed identity; model text cannot choose its source identity.
- Renderer code cannot supply the Lead conversation URL, owner bearer, permissions, or arbitrary browser primitives.
- The owner endpoint is loopback-only, requires a random bearer capability, rejects browser origins, bounds request size, and uses deadlines with redirects disabled.
- Persistent conversation URLs remain private controller state and are not returned by Mission Control or MCP execution tools.
- Browser execution, MCP execution operations, owner HTTP, Electron IPC, and Mission Control project one `CouncilExecutionControlPlane` authority.
- `review` authorizes focus/capture; `wake` authorizes cancel/retry. Execution reads require an authenticated active Council participant.
- Retry is rejected at or after `submit-started`, and for uncertain/completed/waiting-user/policy/limit/conversation-unavailable outcomes.
- Managed MCP and Playwright paths share the same Council ACL and decision gates.
- Council state batches are transactional; browser side effects run only after state commit.
- Hidden chain-of-thought is never collected or rendered as execution telemetry.

## Deliberation

A managed final decision requires an explicit proposal, independent critique of the latest proposal when another participant is involved, no blocked task, and no active `queued`, `dispatched`, or `target-running` wake/review. The final record stores rationale, accepted/rejected arguments, and unresolved risks.

## Development

Requirements:

- Bun `1.3.14`
- a ChatGPT account usable inside the Electron browser

```bash
bun install --frozen-lockfile
cd launcher
bun install --frozen-lockfile
cd ..
bun run verify
bun run app
```

## Verification and releases

Council 4.1 was verified through the complete Windows, macOS, and Ubuntu matrix before release. The required gate is:

```text
bun run verify
→ native Electron package
→ packaged application smoke
```

Pull requests also run `actionlint`, retain verified Electron packages, validate the Windows PowerShell installer, and prepare the AVX2-independent Windows Bun runtime.

Stable releases build native macOS ARM64 and Intel artifacts, Windows x64, Linux x64, runtime archives, license material, installers, and `checksums.txt`. Every published asset must appear in `checksums.txt` before the release is created or updated.

The updater reads stable releases from `Nolane-x/codexweb`, verifies the selected asset against `checksums.txt`, and asks the user to choose **Update now**, **Later**, or **Skip this version**. There is no silent install.

See [`docs/releases/v4.1.0.md`](docs/releases/v4.1.0.md) for the complete Council 4.1 release notes and verification lineage.
