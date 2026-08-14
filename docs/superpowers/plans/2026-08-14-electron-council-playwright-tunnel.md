# Electron-first Council + Playwright + Tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn CodexWeb Council into an Electron-first multi-ChatGPT collaboration app where the existing Secure MCP Tunnel remains intact, while persistent ChatGPT browser conversations are owned/routed by Electron and GitHub Releases provide user-controlled desktop updates.

**Architecture:** Keep the proven tunnel/login/launcher plumbing untouched unless a failing regression requires change. Add a browser-transport controller beside the existing Council MCP path: managed agents are bound to persistent ChatGPT conversations, model outputs end with a strict Council action envelope, Electron validates and applies those actions transactionally, and wakes target the bound conversation before falling back to resurrection. Add release/update plumbing as a separate bounded module so updater failures cannot break Council runtime.

**Tech Stack:** TypeScript 5.9, Bun 1.3.14, Electron 41, React 19, Playwright Core 1.62, existing Secure MCP Tunnel client, GitHub Actions/Releases.

## Global Constraints

- Preserve the existing polished launcher visual system and ChatGPT login/browser partition.
- Preserve existing Tunnel ID/runtime-key install/reconnect/verify behavior.
- Plus correctness must not depend on Full MCP write capability.
- At most 5 ChatGPT browser surfaces execute concurrently.
- Never route by tab index/title/mouse coordinates.
- Browser-surface binding is authoritative identity for Playwright-originated actions.
- No model-emitted arbitrary shell action.
- Wake storms are bounded by per-agent serialization, source-target cooldown, active-wake limit, and depth limit.
- Persistent conversation resume is preferred; resurrection is fallback only.
- Update checks use GitHub Releases, not every commit, and never install without user consent.
- Tunnel/runtime keys and agent capability tokens never enter Council transcript, model-visible shared state, update logs, or dashboard snapshots.

---

### Task 1: Persistent Agent Registry and Surface Leases

**Files:**
- Create: `src/council/agent-registry.ts`
- Modify: `src/council/types.ts`
- Modify: `src/council/validation.ts`
- Test: `tests/council-agent-registry.test.ts`

**Interfaces:**
- Produces: `CouncilManagedAgent`, `CouncilAgentLease`, `CouncilAgentRegistry`, `MAX_ACTIVE_AGENT_SURFACES`.
- `CouncilAgentRegistry.register(input)` creates immutable source identity metadata.
- `bindConversation(agentId, { surfaceId, conversationUrl })` binds a persistent ChatGPT conversation.
- `lease(agentId)` returns the existing lease or assigns one of five deterministic surface slots.
- `release(agentId)` releases the active slot without deleting the persistent conversation binding.

- [ ] **Step 1: Write failing registry tests**

```ts
import { describe, expect, test } from "bun:test";
import { CouncilAgentRegistry, MAX_ACTIVE_AGENT_SURFACES } from "../src/council/agent-registry";

describe("CouncilAgentRegistry", () => {
  test("keeps stable source identity and persistent conversation binding", () => {
    const registry = new CouncilAgentRegistry();
    registry.register({ id: "alice", name: "Alice", role: "Architect", mandate: "Design the system" });
    const lease = registry.lease("alice");
    registry.bindConversation("alice", { surfaceId: lease.surfaceId, conversationUrl: "https://chatgpt.com/c/alice" });
    expect(registry.get("alice")?.conversationUrl).toBe("https://chatgpt.com/c/alice");
    expect(registry.get("alice")?.surfaceId).toBe(lease.surfaceId);
  });

  test("queues the sixth simultaneously active agent", () => {
    const registry = new CouncilAgentRegistry();
    for (let i = 0; i < MAX_ACTIVE_AGENT_SURFACES + 1; i++) {
      registry.register({ id: `a${i}`, name: `A${i}`, role: "Worker", mandate: "Work" });
    }
    for (let i = 0; i < MAX_ACTIVE_AGENT_SURFACES; i++) expect(registry.lease(`a${i}`).status).toBe("active");
    expect(registry.lease(`a${MAX_ACTIVE_AGENT_SURFACES}`).status).toBe("queued");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `bun test tests/council-agent-registry.test.ts`
Expected: FAIL because `agent-registry.ts` does not exist.

- [ ] **Step 3: Implement the minimal registry**

```ts
export const MAX_ACTIVE_AGENT_SURFACES = 5;

export interface CouncilManagedAgent {
  id: string;
  name: string;
  role: string;
  mandate: string;
  status: "active" | "sleeping" | "queued" | "failed";
  surfaceId?: string;
  conversationUrl?: string;
  lastCouncilEventId?: string;
  checkpoint?: string;
}

export class CouncilAgentRegistry {
  // stable id map + five surface leases; never infer identity from model output
}
```

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/council-agent-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/council/agent-registry.ts src/council/types.ts src/council/validation.ts tests/council-agent-registry.test.ts
git commit -m "feat: add persistent Council agent registry"
```

### Task 2: Strict Browser Action Envelope and Transactional Validation

**Files:**
- Create: `src/council/browser-actions.ts`
- Create: `src/council/browser-action-parser.ts`
- Create: `src/council/browser-action-transaction.ts`
- Modify: `src/council/store.ts`
- Test: `tests/council-browser-actions.test.ts`

**Interfaces:**
- Produces: `CouncilBrowserAction`, `CouncilActionBatch`, `parseCouncilActionFooter(text)`, `validateCouncilActionBatch(sourceAgentId, batch, state)`, `applyCouncilActionBatch(...)`.
- Footer format is exactly one terminal block:

```text
<COUNCIL_ACTIONS version="1">
{"actions":[{"type":"SAY","room_id":"core","body":"..."}]}
</COUNCIL_ACTIONS>
```

- Source `agent_id` is never accepted from model JSON; controller supplies it.

- [ ] **Step 1: Write failing parser/identity/transaction tests**

```ts
const parsed = parseCouncilActionFooter(`Answer\n<COUNCIL_ACTIONS version="1">\n{"actions":[{"type":"WAKE","target_agent_id":"bob","room_id":"core","reason":"Review"}]}\n</COUNCIL_ACTIONS>`);
expect(parsed.visibleText).toBe("Answer");
expect(parsed.batch.actions[0]?.type).toBe("WAKE");
expect(() => parseCouncilActionFooter("<COUNCIL_ACTIONS version=\"1\">{bad}</COUNCIL_ACTIONS>")).toThrow();
```

Also test that an action containing `agent_id: "bob"` is rejected, and that if one of two actions is invalid none of the batch mutations are committed.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `bun test tests/council-browser-actions.test.ts`
Expected: FAIL for missing parser/types.

- [ ] **Step 3: Implement strict schema and transaction boundary**

Allowed actions in V1: `SAY`, `PROPOSE`, `REPLY`, `WAKE`, `SPAWN_AGENT`, `CREATE_TASK`, `UPDATE_TASK`, `REQUEST_REVIEW`, `FINAL_DECISION`, `CHECKPOINT`, `SLEEP`.
Reject unknown fields for security-sensitive action objects; reject more than 16 actions or more than 64 KiB action JSON; reject shell/URL execution fields; apply to a cloned Council state and persist only after all validations succeed.

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/council-browser-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/council/browser-actions.ts src/council/browser-action-parser.ts src/council/browser-action-transaction.ts src/council/store.ts tests/council-browser-actions.test.ts
git commit -m "feat: add transactional browser Council protocol"
```

### Task 3: Persistent Playwright Conversation Transport

**Files:**
- Create: `src/council/browser-transport.ts`
- Create: `src/council/conversation-registry.ts`
- Modify: `src/adapters/chatgpt-web/browser-worker.ts`
- Modify: `src/chatgpt-session.ts`
- Test: `tests/council-browser-transport.test.ts`

**Interfaces:**
- Produces: `CouncilBrowserTransport.resumeOrCreate(agent, prompt, signal)` returning `{ answer, conversationUrl, resumed }`.
- Browser worker gains an explicit persistent-conversation mode; existing temporary-chat behavior remains the default for legacy callers.
- Resume uses the exact stored conversation URL/Page object. No tab-title/index fallback is permitted.

- [ ] **Step 1: Write failing transport contract tests**

Test with a fake browser adapter that:
1. resumes `https://chatgpt.com/c/bob` when healthy;
2. falls back to `createConversation()` when resume fails;
3. returns the newly observed conversation URL;
4. never calls approximate-tab lookup.

- [ ] **Step 2: Run focused tests**

Run: `bun test tests/council-browser-transport.test.ts`
Expected: FAIL for missing transport.

- [ ] **Step 3: Add persistent mode to the existing browser worker**

Add a narrow options object instead of forking the worker:

```ts
interface ChatGptBrowserRunOptions {
  conversation?: { mode: "temporary" } | { mode: "persistent"; url?: string };
}
```

Legacy callers omit it and keep current behavior. Council callers use persistent mode.

- [ ] **Step 4: Run browser-worker and Council transport tests**

Run: `bun test tests/council-browser-transport.test.ts tests/browser-worker-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/council/browser-transport.ts src/council/conversation-registry.ts src/adapters/chatgpt-web/browser-worker.ts src/chatgpt-session.ts tests/council-browser-transport.test.ts
git commit -m "feat: add persistent ChatGPT conversation transport"
```

### Task 4: Agent Manager, Spawn, Wake, Resume, Resurrection

**Files:**
- Create: `src/council/agent-manager.ts`
- Create: `src/council/resurrection.ts`
- Modify: `src/council/wake-engine.ts`
- Modify: `src/council/browser-action-transaction.ts`
- Test: `tests/council-agent-manager.test.ts`
- Test: `tests/council-resurrection.test.ts`

**Interfaces:**
- Produces: `CouncilAgentManager.spawn(...)`, `.wake(...)`, `.runTurn(...)`.
- `SPAWN_AGENT` allocates/registers an agent and creates its persistent ChatGPT conversation when a slot is available; otherwise status is queued.
- `wake` prefers exact persistent resume and sends only delta context; full `buildResurrectionPrompt(...)` is used only after resume fails.

- [ ] **Step 1: Write failing manager tests**

Cover spawn of Bob/Carol by Alice, correct-source stamping, Bob persistent wake, sixth-agent queue, wake cooldown/depth, and fallback resurrection.

- [ ] **Step 2: Run tests and confirm failure**

Run: `bun test tests/council-agent-manager.test.ts tests/council-resurrection.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement manager and resurrection compiler**

Resurrection prompt contains role/mandate/project mission/latest checkpoint/current proposals & blocking objections/recent relevant messages/decisions/assigned work/wake reason, with all peer content inside an explicit untrusted-data block. Do not include chain-of-thought or secrets.

- [ ] **Step 4: Run focused + existing wake security tests**

Run: `bun test tests/council-agent-manager.test.ts tests/council-resurrection.test.ts tests/council-security.test.ts tests/council-wake-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/council/agent-manager.ts src/council/resurrection.ts src/council/wake-engine.ts src/council/browser-action-transaction.ts tests/council-agent-manager.test.ts tests/council-resurrection.test.ts
git commit -m "feat: orchestrate persistent Council agents and wakes"
```

### Task 5: Decision Gates and Real Role ACLs

**Files:**
- Create: `src/council/policy.ts`
- Modify: `src/council/types.ts`
- Modify: `src/council/browser-action-transaction.ts`
- Modify: `src/council/mcp-tools-work.ts`
- Test: `tests/council-policy.test.ts`

**Interfaces:**
- `CouncilPermission = "spawn" | "finalize" | "reopen" | "assign" | "wake" | "review"`.
- Agent ACLs are controller state, not parsed from model output.
- `canFinalizeDecision` requires Chair/finalize permission plus no unresolved blocking objection and required review evidence.

- [ ] **Step 1: Write failing ACL/decision tests**

Test Critic cannot `FINAL_DECISION`; Chair can only finalize after blocking objections are resolved; model changing its textual role does not change permissions.

- [ ] **Step 2: Run focused test**

Run: `bun test tests/council-policy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement policy enforcement in both browser and MCP mutation paths**

MCP remains optional, but must use the same policy layer so transport choice cannot bypass ACLs.

- [ ] **Step 4: Run tests**

Run: `bun test tests/council-policy.test.ts tests/council-mcp-contract.test.ts tests/council-security.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/council/policy.ts src/council/types.ts src/council/browser-action-transaction.ts src/council/mcp-tools-work.ts tests/council-policy.test.ts
git commit -m "feat: enforce Council decision gates and role ACLs"
```

### Task 6: Electron Agent/Surface UI Without Rewriting Existing Shell

**Files:**
- Create: `launcher/src/CouncilAgentsPanel.tsx`
- Create: `launcher/src/CouncilTasksPanel.tsx`
- Modify: `launcher/src/CouncilDock.tsx`
- Modify: `launcher/src/main.tsx`
- Modify: `launcher/src/council.css`
- Modify: `launcher/electron/preload.cjs`
- Modify: `launcher/electron/main.cjs`
- Test: `launcher/tests/council-renderer-contract.test.cjs`

**Interfaces:**
- UI displays agents, status, role/mandate, active/queued surface, persistent-conversation indicator, wake/sleep, tasks, decisions, and safe memory summary.
- Renderer IPC exposes bounded controller operations; no raw filesystem/shell primitives.

- [ ] **Step 1: Write failing renderer/IPC contract tests**

Assert original App remains mounted, Council components are additive, IPC allow-list contains only Council controller methods, and no tunnel/runtime secret is returned to renderer snapshots.

- [ ] **Step 2: Run launcher tests**

Run: `bun run --cwd launcher test`
Expected: new contract test FAIL.

- [ ] **Step 3: Implement additive panels and IPC**

Preserve original login/browser experience and existing Connect panel styling. When opening a managed agent, activate the exact bound browser surface; closing the panel restores prior surface state.

- [ ] **Step 4: Run launcher typecheck/test/build**

Run: `bun run --cwd launcher typecheck && bun run --cwd launcher test && bun run --cwd launcher build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add launcher/src launcher/electron launcher/tests/council-renderer-contract.test.cjs
git commit -m "feat: add Electron Council agent workspace"
```

### Task 7: Release Build and User-controlled Update Notifications

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `launcher/electron/update-service.cjs`
- Create: `launcher/src/CouncilUpdatePrompt.tsx`
- Modify: `launcher/electron/main.cjs`
- Modify: `launcher/electron/preload.cjs`
- Modify: `launcher/src/main.tsx`
- Modify: `launcher/package.json`
- Test: `launcher/tests/update-service.test.cjs`
- Test: `tests/release-workflow-contract.test.ts`

**Interfaces:**
- `UpdateService.check()` reads the latest GitHub Release for `Nolane-x/codexweb`, compares semver, validates platform artifact metadata, and returns a pure update descriptor.
- UI provides `Update now`, `Later`, `Skip this version`.
- V1 `Update now` opens/downloads the exact release artifact through a controlled updater path; no silent installation.
- Release workflow triggers on `v*` tags, runs verify/package on Windows/macOS/Linux, uploads artifacts, SHA-256 manifest, and `update.json` metadata to the GitHub Release.

- [ ] **Step 1: Write failing updater/workflow tests**

Test semver comparison, ignored skipped version, stable GitHub Release parsing, platform artifact selection, SHA-256 metadata requirement, and workflow trigger/artifact matrix.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `bun run --cwd launcher test && bun test tests/release-workflow-contract.test.ts`
Expected: FAIL for missing updater/workflow.

- [ ] **Step 3: Implement release workflow and updater**

Do not require code-signing secrets for CI verification; when signing secrets are absent, publish unsigned research artifacts with explicit metadata. Never mark unsigned artifacts as signed. Preserve user data paths across installation.

- [ ] **Step 4: Run launcher + release contract tests**

Run: `bun run --cwd launcher test && bun test tests/release-workflow-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml launcher/electron/update-service.cjs launcher/src/CouncilUpdatePrompt.tsx launcher/electron/main.cjs launcher/electron/preload.cjs launcher/src/main.tsx launcher/package.json launcher/tests/update-service.test.cjs tests/release-workflow-contract.test.ts
git commit -m "feat: add Electron release and update notifications"
```

### Task 8: Full Verification, Packaging, Recovery Docs, and Milestone Artifact

**Files:**
- Modify: `README.md`
- Modify: `docs/council.md`
- Create: `docs/testing/electron-council-live-test.md`
- Create: `docs/security/electron-council-threats.md`

**Interfaces:**
- Documents exact Tunnel setup, Plus browser-transport behavior, persistent agents, update flow, security boundaries, and live Alice/Bob/Chair acceptance test.

- [ ] **Step 1: Run all repository verification**

Run:

```bash
bun install --frozen-lockfile
bun run verify
bun run app:package
bun run app:smoke
```

Expected: PASS on the current platform.

- [ ] **Step 2: Verify GitHub Actions configuration**

Push/PR CI must cover Windows/macOS/Linux verification. Release workflow must be syntactically valid and build the same package commands used locally.

- [ ] **Step 3: Update docs with tested, exact user flow**

Include: launch Electron → ChatGPT login → Connect Tunnel → create `CodexWeb Council` plugin with same Tunnel and Authentication None → create ChatGPT Project → first AI mission → spawn agents → deliberate → final decision → assigned tasks → release update prompt.

- [ ] **Step 4: Create a complete milestone ZIP**

Create a ZIP from the verified repository tree including source, tests, docs, and build metadata; exclude dependency caches and secrets. Persist a copy to ChatGPT Library when file-library mutation is available.

- [ ] **Step 5: Commit documentation and report exact verification evidence**

```bash
git add README.md docs
git commit -m "docs: complete Electron Council milestone"
```
