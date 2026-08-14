# CodexWeb Council 3.0 — Security Review

Date: 2026-08-14
Scope: Electron-first managed Council, Secure MCP Tunnel compatibility, Playwright child-agent transport, owner fallback, local state, updater/release path.

## Security properties

Council 3.0 is designed as **single-owner local desktop software**, not a multi-tenant service. Its primary security boundaries are:

- Electron assigns managed child identity from browser binding; model text cannot choose its source identity.
- Managed permissions are controller-side state and apply to both Playwright actions and MCP privileged mutations.
- Persistent ChatGPT conversation URLs and private checkpoints stay outside the public renderer snapshot.
- Per-agent MCP capability tokens stay outside public Council transcript/UI state.
- Owner fallback uses a distinct random loopback bearer capability stored in an owner-only local descriptor.
- Council action batches commit shared state atomically before browser side effects.
- Wake/spawn recursion and simultaneous browser work are bounded.
- Release downloads are pinned to the Nolane-x repository path and SHA-256 verified before install.

## Findings fixed during 3.0 development

### Identity and authorization

1. **Model-supplied agent impersonation** — fixed by controller-owned browser binding plus MCP per-agent capabilities.
2. **Child permission escalation** — fixed by permission-subset delegation and controller ACLs.
3. **MCP/browser ACL mismatch** — fixed by a shared managed authorizer on privileged MCP operations.
4. **Managed-project privilege bypass by unmanaged MCP participant** — fixed: after a managed project exists, an unmanaged participant may still read/speak/propose/reply, but privileged managed actions (`wake`, `assign`, `reopen`, `finalize`) are rejected.
5. **Project Lead takeover** — fixed: the earliest Council participant owns first managed bootstrap; an active project cannot be replaced by a later participant.
6. **Final-policy shortcut** — fixed with decision gate requiring proposal, independent response when multiple participants are involved, zero blocked tasks, and zero active wake/review requests.

### Persistence and concurrency

7. **Half-applied model action batch** — fixed with `CouncilStore.transaction`; shared-state mutations persist once or roll back fully.
8. **Duplicate work after generic browser error** — fixed: only explicit missing/deleted conversation evidence permits resurrection into a new conversation.
9. **Wake/spawn loops** — bounded by per-target serialization, cooldown, queue cap, max recursion depth, and five active browser surfaces.
10. **Double wake creation** — managed delivery consumes an already-created durable wake rather than generating a second event.

### Secret and private-context handling

11. **Wake caller could receive target private checkpoint** — fixed: caller receives only wake receipt; target context is built only inside delivery.
12. **Capability leakage into Council content** — fixed with MCP-side token DLP and fallback redaction.
13. **Peer prompt injection adjacent to wake protocol** — fixed by isolating peer/room/task/repository text as untrusted collaboration data.
14. **Owner-control token persistence robustness** — fixed with mode-0600 atomic temp+rename writes under an owner-only directory.
15. **Owner-control redirect/token forwarding risk** — fixed: Electron client rejects redirects, pins loopback endpoint shape, and has a bounded timeout.
16. **Renderer authority over Plus fallback** — fixed: renderer can request `bindCurrentLead()` but cannot provide URL, identity, permissions, mission, or owner token; Electron main reads the current ChatGPT conversation itself.

### Electron / browser lifecycle

17. **Tab/title/coordinate wake ambiguity** — eliminated; managed routing uses stable binding keys and Page/surface mappings.
18. **Surface identifier mismatch** — fixed by accepting the launcher's actual bounded surface-id format.
19. **Persistent turn phase mismatch** — fixed by explicit launcher phase validation.
20. **Subclass pre-initialization crash risk** — fixed by guarding Council BrowserHost overrides until the agent registry is initialized.

### Update / supply chain

21. **Updater still pinned to upstream project** — fixed; update metadata/assets are pinned to `Nolane-x/codexweb`.
22. **Silent update behavior** — not introduced. UI requires user choice: Update now / Later / Skip this version.
23. **Unverified package delivery** — existing updater keeps HTTPS/path pinning and SHA-256 verification against release checksums.

## Remaining known boundaries

### Same-OS-user local boundary

The human Council dashboard is bound to `127.0.0.1` and contains no capability tokens, private checkpoints, or managed conversation URLs. The packaged Electron renderer uses `Origin: null`, so the read-only dashboard remains intentionally accessible to the local owner context. Another hostile process or local-file web context running as the **same OS user** may be able to read the public Council transcript. This is not considered multi-user isolation.

### Prompt-injection judgment risk

Controller ACLs prevent peer text from directly becoming privileged execution, but an LLM may still be persuaded by malicious task/repository content when deciding what public conclusion to produce. Mitigations include untrusted-data separation, explicit role/mandate prompts, strict action schema, source identity binding, ACL checks, and final decision gates. This remains a model-judgment risk rather than a solved information-flow problem.

### Lead authority

The Lead intentionally has broad permissions and can delegate subsets. Compromise of the Lead conversation can therefore influence project direction and create/wake allowed child roles. It cannot grant permissions the Lead itself does not hold, escape the supported action schema, or execute arbitrary shell commands through the browser protocol.

### GitHub account / release trust

The updater validates repository path and SHA-256, but checksums and release assets share the GitHub repository/account trust domain. Compromise of the repository release authority is therefore a software supply-chain boundary. GitHub account protection, branch/release protection, and signed artifacts are recommended for future hardening.

### Platform verification

Local verification performed on the final feature-branch snapshot:

- `bun run verify` — pass
- `bun run app:package` — pass (Linux)
- `bun run app:smoke` — pass (packaged Linux app)
- `bun audit` — pass
- `cd launcher && bun audit` — pass

macOS ARM64/x64 and Windows x64 packaging must still pass the repository GitHub Actions workflow before publishing the `v3.0.0` release. The GitHub connector did not have permission to enable/read Actions settings on this fork, and no workflow runs were visible during this implementation session.

## Release recommendation

Do not publish the `v3.0.0` tag until:

1. GitHub Actions is enabled for the fork;
2. PR/main CI passes;
3. four-platform release build + smoke passes;
4. produced artifacts and `checksums.txt` are attached to the GitHub Release.
