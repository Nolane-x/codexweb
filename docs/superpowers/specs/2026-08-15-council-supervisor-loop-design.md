# Council Supervisor Loop Design

## Goal

Turn CodexWeb Council into a self-maintaining ChatGPT team: spawned agents receive a real Council connector-backed ChatGPT conversation, sleeping/stalled agents can be resumed automatically, one user-selected manager can inspect the whole project on a 20-minute cadence, and old observation data remains inspectable/deletable and usable as bounded project memory.

## Product behavior

- The launcher shows a Chrome-like project tab strip for every managed ChatGPT agent, including sleeping/queued/failed agents whose conversation is saved but whose browser surface is not currently leased.
- The user can choose exactly one managed agent as Project Manager. Clearing that selection stops the supervisor timer immediately.
- While a manager is selected, the local Council runtime starts a 20-minute observation loop. Runs never overlap.
- Every observation run walks project agents sequentially. For each saved conversation it opens/resumes that exact conversation, scrolls the ChatGPT conversation to the bottom, waits for layout to settle, captures a PNG viewport, records safe health evidence, releases the browser lease, then proceeds to the next agent.
- The manager is called only after the sequential capture pass completes. Screenshots are attached to one manager turn with a compact manifest and recent bounded project memory. The manager is instructed to identify stuck/rate-limited/disconnected/idle agents and issue Council actions.
- Manager-produced wake/review/spawn effects are executed sequentially through the existing managed-agent queue. The system never fans out multiple browser automations at once.
- Spawn and wake are durable: temporary lack of browser capacity becomes queued/retryable work instead of a terminal failure.
- Managed ChatGPT turns use the exact `CodexWeb Council` connector in the composer before sending. A connector selection must be visibly confirmed; connector setup failure is explicit and retryable rather than silently falling back to a connector-less agent.
- Rate-limit, sign-in/session, missing-conversation, closed surface, network/DOM, response-stall, and browser-capacity failures are classified into safe health categories. The supervisor can distinguish retryable infrastructure failure from an agent that is simply sleeping.

## Observation archive

Observation data lives under the existing private Council data directory and never enters the public shared projection as raw paths or credentials.

Each run stores:

- run id, project room id, manager agent id, timestamps and overall status;
- one record per observed agent with safe health category, capture timestamp and screenshot file name;
- manager analysis text, selected actions and safe error summary;
- optional bounded text excerpts required for future continuity.

The archive has configurable retention by total runs/bytes. The default keeps 72 runs and 512 MiB, pruning oldest data first. Users can inspect run metadata/screenshots in the launcher and delete one run or clear the archive. Deletion removes both metadata and image files atomically where possible.

AI access is bounded: resurrection/manager prompts may include a compact memory digest from recent retained runs, and MCP exposes list/read observation tools that return safe metadata/analysis, never arbitrary local filesystem paths.

## Components

### `CouncilWorkScheduler`

A single-concurrency FIFO scheduler for managed browser work. Spawn, wake, review wake, and supervisor manager follow-up use it. Capacity errors remain queued with bounded retry/backoff instead of becoming `failed` immediately.

### `CouncilSupervisor`

Owns manager selection, timer, non-overlapping observation runs, sequential capture, manager turn, failure classification, archive writes and retention. The runtime exposes a small owner-only HTTP control surface for launcher selection/history operations.

### `CouncilObservationStore`

Versioned private JSON index plus PNG files. Provides list/get/delete/clear, retention pruning, safe memory digest construction and corruption-tolerant loading.

### Browser observation support

`CouncilBrowserTransport` gains `captureConversation()`. `PlaywrightCouncilChatDriver` gains screenshot capture and reusable connector selection for managed turns. Capture is read-only: it must not submit a prompt.

### Launcher

A project tab strip shows all managed agents and current state. Agent rows gain manager radio selection. A Supervisor/History section shows cadence, last run, failures, archive size, thumbnails and delete controls. UI control calls owner-only local APIs through Electron IPC; renderer never receives conversation URLs or local archive paths.

## Failure and liveness rules

- no overlapping supervisor run;
- no parallel agent capture or wake fan-out;
- manager cleared => timer stopped and pending future cycles cancelled;
- active turn is not interrupted by observation; the capture waits/retries;
- rate-limit and transient connection errors use bounded exponential backoff with jitter and an expiry;
- explicit account/message-limit evidence marks the agent `limited` until a later successful turn or a cooldown expires;
- stale presence alone does not prove failure;
- no retry after evidence that a prompt was submitted, preventing duplicate ChatGPT turns;
- missing conversation may resurrect into a new conversation only through the existing explicit resurrection path;
- screenshot/manager failures are archived as failed observations and do not recursively trigger another supervisor run.

## Security and privacy

Conversation URLs, agent capability tokens, owner token, local paths and raw connector internals remain private controller state. Screenshot files are stored mode 0600 under a mode 0700 directory where supported. HTTP/IPC history APIs use opaque run/file identifiers. Manager screenshots are treated as untrusted collaboration data and cannot override system/developer rules.

## Testing

Add focused Bun tests for scheduler queue/retry, supervisor sequencing, archive retention/delete, prompt memory bounds, connector-backed managed turns and observation capture. Add Electron node tests for owner control, state/IPC contracts and Chrome-like tab/supervisor renderer wiring. CI must pass root tests/typecheck/build plus launcher tests/typecheck/build before merge.
