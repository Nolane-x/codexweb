# CodexWeb Council 3.1

**A standalone Electron control center where normal ChatGPT conversations can form a persistent AI team, deliberate, wake one another, reach policy, divide work, and continue in their own conversations.**

## What changed in 3.1

Council no longer uses Codex as an active product dependency. The packaged Council entrypoint does not load the retired Codex launcher main, does not install or restore an `openai_base_url`, does not require a Codex model catalog, and does not read or mutate `~/.codex/config.toml` during Council/Tunnel setup.

The old codexweb app configuration may be read **only** as a source of already-saved Secure MCP Tunnel credentials so users can reconnect without re-entering them. Codex configuration and the legacy integration journal are outside the Council setup transaction.

```text
ChatGPT Project conversation
          │
          │ Bind current ChatGPT as Lead
          ▼
┌─────────────────────────────────────────────────┐
│              CODEXWEB COUNCIL                   │
│                                                 │
│  Electron browser/login    Council state        │
│           │             rooms/tasks/policy      │
│           └──────────────┬──────────────────────│
│                          ▼                      │
│                   Agent Manager                 │
│                ┌─────────┼─────────┐            │
│                ▼         ▼         ▼            │
│             Architect  Critic   Reviewer        │
│                persistent ChatGPT chats         │
│                     via Playwright              │
└─────────────────────────────────────────────────┘
          ▲
          │
OpenAI Secure MCP Tunnel
starts the local Council service
```

## ChatGPT Plus flow

1. Open the Electron app and sign in to ChatGPT in its browser.
2. Open **Connect** and reconnect your saved OpenAI Secure MCP Tunnel, or enter the Tunnel ID plus Tunnels Read + Use key once.
3. Open the persistent ChatGPT Project conversation you want as the coordinator.
4. Open **Agents** and choose **Bind current ChatGPT as Lead**.
5. Electron validates the actual `https://chatgpt.com/c/...` conversation itself and sends the Council bootstrap into that same conversation.
6. Lead can create specialist child AI conversations, request critique, wake them, assign work, and resume their persistent chats later.

The Plus browser path uses Electron + Playwright for AI-to-AI writes; it does not depend on Plus having Full MCP write actions.

## Optional ChatGPT connector

If the ChatGPT workspace exposes custom MCP capabilities, create a separate connector named exactly:

```text
CodexWeb Council
```

Choose the same Secure MCP Tunnel and the authentication mode supported by the workspace. The connector is optional for the Plus browser path and is no longer a prerequisite for persistent child-agent communication.

## Security boundaries

- Electron assigns managed identity; model text cannot choose its source identity.
- Renderer code cannot supply the Lead conversation URL, owner bearer, permissions, or agent id.
- The owner endpoint is loopback-only, requires a random bearer capability, rejects every browser `Origin`, bounds request size, and uses a deadline with redirects disabled.
- Owner capability metadata is written atomically and removed when the Council runtime stops.
- Persistent conversation URLs are private controller state and are not returned by the public Council dashboard.
- Managed MCP and Playwright paths share the same ACL and decision gates.
- Wake/spawn fan-out is bounded, with at most five active browser surfaces.
- Council state batches are transactional; browser side effects run only after state commit.

## Deliberation

A managed final decision requires an explicit proposal, independent critique when more than one participant is involved, no blocked task, and no pending/delivering wake or review. The final record stores rationale, accepted/rejected arguments, and unresolved risks.

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

Pull requests run verify, native Electron package, packaged-app smoke, and retain artifacts on Windows, Linux, and macOS. Stable releases additionally build native macOS ARM64 and Intel artifacts, Windows x64, Linux x64, runtime archives, and `checksums.txt` before publishing.

The updater reads stable releases from `Nolane-x/codexweb`, verifies the selected asset against `checksums.txt`, and asks the user to choose **Update now**, **Later**, or **Skip this version**. There is no silent install.

Do not tag or publish a version unless the release SHA passes the complete platform matrix.
