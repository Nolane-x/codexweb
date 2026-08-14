# ChatGPT Council V1 Implementation Plan

1. Build the typed owner-local Council store with atomic persistence, threaded chat, proposals, decisions, tasks, wakes, checkpoints, and bounded resurrection packets.
2. Expose standalone Council MCP tools with explicit `agent_id` on every non-join call and no Codex turn-token dependency.
3. Repoint the active tunnel MCP entry to Council while retaining the former Codex MCP source only as legacy rollback/reference code.
4. Reuse the existing ChatGPT browser worker as a serialized per-agent wake engine that injects a bounded resurrection packet and requires the resumed ChatGPT to re-enter Council through MCP.
5. Add a loopback-only read-only public snapshot that excludes private checkpoints and restricts browser CORS to the packaged renderer or localhost development origins.
6. Mount an additive Discord-like `CouncilDock` and Council connection panel beside the untouched existing launcher App/style system.
7. Add a dedicated `council-setup` migration path that restores/removes the previous managed Codex route, configures the exact `CodexWeb Council` connector identity, and reuses/installs Secure MCP Tunnel credentials.
8. Wrap the former large CLI/runtime/supervisor implementations as explicit legacy modules. In Council mode the supervisor starts Tunnel only and never starts the Responses daemon.
9. Add store/MCP/wake/HTTP/product-mode/renderer/runtime contract tests and strict compile harnesses.
10. Verify the final Git graph is a clean fast-forward and report any unavailable GitHub Actions evidence explicitly instead of assuming CI success.
