# ChatGPT Council V1 Implementation Plan

1. Add typed Council domain/store with atomic owner-local persistence and tests for threads, decisions, tasks, wakes, failures, and bounded resurrection packets.
2. Add standalone Council MCP tools with explicit stable `agent_id` on every call and no Codex turn token or transport-session identity dependency.
3. Repoint the existing tunnel `mcp` entry to Council while retaining old broker source as legacy rollback/reference code.
4. Add `CouncilWakeEngine` on top of the existing ChatGPT browser worker so a wake schedules a real ChatGPT Web resurrection turn in Full mode.
5. Preserve the current Electron launcher UI unchanged during V1. Defer the Discord-like Council surface to V1.1 after core CI and live wake validation, so UI quality cannot regress during the transport migration.
6. Document the new `CodexWeb Council` connector identity and migration boundary.
7. Run root tests/typecheck and existing CI; fix regressions before considering V1 complete.
