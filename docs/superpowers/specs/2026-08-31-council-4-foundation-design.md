# Council 4.0 Foundation Design

Council 4.0 turns CodexWeb from a collection of loosely coupled overlays and browser actions into a single Mission Control with explicit connection truth, persistent managed conversations, fail-closed browser automation, and a self-describing MCP control plane.

## Core invariants

1. A parked/sleeping managed agent with a persistent ChatGPT conversation remains reopenable by stable agent identity. The renderer never receives the private conversation URL.
2. The ChatGPT MCP connector is an optional capability enhancement, not a single point of failure for Playwright-managed Council turns.
3. Tunnel, Council runtime, MCP server, ChatGPT connector, Playwright surfaces, and ChatGPT session are independent health boundaries and must never be collapsed into one online boolean.
4. Post-submit ambiguity remains fail-closed. Deep thinking is live work, not a stall signal.
5. Mission Control is the single navigation authority for Council operations; setup, supervisor, agents, work, connections, diagnostics, memory, and browser documents are destinations inside one workspace.
6. MCP is self-describing and authenticated. Read-model expansion must not leak credentials, persistent conversation URLs, private checkpoints, prompt bodies, filesystem paths, or screenshot bytes.
7. Multi-agent finalization requires independent critique in the latest proposal thread when another participant is involved.

## Foundation modules

- `CouncilManagedRuntime.focusAgentConversation()` and owner-only bridge for persistent conversation focus.
- `chatgpt-connector-policy.ts` for optional connector semantics.
- `chatgpt-deep-state.ts` for deterministic ChatGPT lifecycle classification.
- `councilConnectionModel.ts` for layered renderer connection truth.
- `control-plane.ts` and `mcp-tools-system.ts` for MCP capability negotiation and diagnostics.
- Mission Control renderer shell and additive Council 4 CSS surfaces.
- DecisionGate v2 independent-critique policy.

## Verification policy

No claim that the foundation is merge-ready is made until GitHub CI verifies Bun tests, typecheck/build, Electron packaging/smoke, and cross-platform behavior. Local Node-accessible tests are supporting evidence only.
