# Council 4.1 Execution Control Plane — Verification Record

Date: 2026-09-01
Status: **COMPLETE — MERGED AND RELEASED AS v4.1.0**

## Verified code boundary

- Repository: `Nolane-x/codexweb`
- Base: `main` at `a59953702cbc33c26e24d953ad1ff85b2dc73f8e`
- Verified Council 4.1 code head: `46a60de3aa5a3f2686afa524bfbd626539ecf985`
- Pull-request merge commit exercised by the final code CI: `8fb881fb631ccfc33f9cf4995e4ca4e214253614`
- Final code CI: run #363, run id `33467807496`
- Council 4.1 final integration merge: `859b4c7a`
- Release-policy hotfix merge: `d7e50ed890288b416219511e694530ab079ad50e`
- Stable v4.1.0 release merge: `440bdfda86a9dda2e909b9f2e527433c0652fff7`

## Cross-platform gate

| Gate | Ubuntu | macOS | Windows |
| --- | --- | --- | --- |
| `bun run verify` | PASS | PASS | PASS |
| `bun run app:package` | PASS | PASS | PASS |
| packaged `bun run app:smoke` | PASS | PASS | PASS |
| packaged artifact retention | PASS | PASS | PASS |

GitHub Actions `actionlint` also passed. Windows additionally passed the PowerShell 5.1 installer validation and the AVX2-independent bundled-runtime preparation gate.

## Fresh test evidence from run #363

The Ubuntu verification job on the final Council 4.1 code boundary reported:

- core test suite: **496 passed, 0 failed**, across 88 files, with 2022 `expect()` calls;
- launcher suite: **199 passed, 0 failed**;
- TypeScript checks passed;
- renderer production build passed;
- `bun audit` reported no vulnerabilities;
- relocatable runtime smoke reported `RELOCATABLE_RUNTIME_SMOKE_OK`;
- packaged launcher smoke reported `PACKAGED_LAUNCHER_SMOKE_OK linux/x64`.

The same CI workflow completed package and packaged-smoke gates successfully on Windows and macOS as well.

## Council 4.1 authority and safety evidence

The verified implementation preserves one execution authority: `CouncilExecutionControlPlane`. Browser execution, MCP execution operations, owner HTTP operations, Electron IPC and Mission Control all project or command that same authority rather than maintaining a second renderer-owned execution truth.

The verified owner/Electron boundary provides eight bounded execution operations:

1. list execution runs;
2. read one execution run;
3. read bounded execution events;
4. read immutable command receipts;
5. cancel an execution run;
6. focus an execution agent;
7. capture an execution agent;
8. retry an execution run when retry safety permits it.

Owner HTTP security tests passed for all of the following invariants:

- missing or incorrect owner bearer is rejected;
- browser origins, including `file://`/`null`, are rejected;
- only the bearer-authenticated Electron-main request shape is accepted;
- malformed payloads fail closed;
- execution routes expose only opaque run and agent identifiers;
- URL, selector, script and prompt smuggling is rejected.

The preload/renderer contract does not receive the owner token and does not accept raw browser URL, selector, script or prompt primitives. Operator actions are represented by immutable accepted/rejected command receipts, including the fixed Electron owner actor identity.

Retry remains mechanically fail-closed at the external submission boundary. Pre-submit retry can consume only the private replay capability owned by the runtime; once `submit-started` is reached, retry is forbidden, and ambiguous post-submit work is represented as uncertain/operator-resolution-required rather than replayed automatically.

## Mission Control execution observability

The verified Mission Control integration adds `Executions` as one destination in the existing single shell rather than creating a parallel execution application. The Execution Inspector:

- consumes only the typed trusted launcher API;
- orders abnormal/attention-requiring work first;
- displays runtime Deep State telemetry without exposing or inventing hidden reasoning;
- displays retry safety and failure-family information;
- renders bounded execution events and immutable command receipts;
- enables retry and cancel only from mechanically valid current run state;
- exposes focus/capture only through controller-owned agent identity;
- feeds the latest public execution state into Overview and Agents badges.

## TDD and integration provenance

- Task 6 owner/Electron verification: CI #361, run id `33467019501`, passed verify/package/packaged-smoke on Windows, macOS and Ubuntu.
- Task 7 isolated Inspector verification: CI #362, run id `33467169486`, passed verify/package/packaged-smoke on Windows, macOS and Ubuntu.
- The exact Task 7 integration object verified by #362 was `46a60de3aa5a3f2686afa524bfbd626539ecf985`, with parents `b2d0ab1bb633d2773bdf013cc97ab07df8f9a14e` and `8b0b2757d11b40337d0d831f5a1590fb0033bb39`.
- Final code verification on the Council 4.1 pull-request context: CI #363, run id `33467807496`, completed successfully across all required gates.
- Final integration PR #17 was merged after its documentation-inclusive CI passed.
- Post-merge Council 4.1 CI on `main` passed on Windows, macOS and Ubuntu.
- Release-policy no-op behavior was fixed and independently verified before the stable version bump.

## Stable v4.1.0 release evidence

- Release preparation PR #20 exact head: `987703eecc47091a763a5149590a33731c856dcd`.
- Pre-merge release CI #371 passed `actionlint` and `verify → package → packaged smoke` on Windows, macOS and Ubuntu.
- PR #20 merged to `main` as `440bdfda86a9dda2e909b9f2e527433c0652fff7`.
- Post-merge CI #372, run id `33488257655`, completed with conclusion `success` on that exact merge commit.
- Release workflow #37, run id `33488257699`, completed with conclusion `success` on the same merge commit.
- All four native release build jobs passed verification, packaging and packaged smoke. The two macOS jobs also passed embedded-runtime and packaged-application signature verification.
- The publish job generated `checksums.txt`, passed `Verify every published asset is checksummed`, created tag `v4.1.0`, and published the GitHub release.
- `refs/tags/v4.1.0` resolves exactly to `440bdfda86a9dda2e909b9f2e527433c0652fff7`.
- GitHub reports `v4.1.0` as the latest stable release (`draft=false`, `prerelease=false`).
- Published assets include the four runtime archives, Windows x64 installer, Linux x64 AppImage, macOS ARM64/x64 DMG and ZIP packages, installer scripts, license/notices, demo media and `checksums.txt`; GitHub exposes SHA-256 digests for uploaded assets.

## Final status

Council 4.1 has satisfied all eight implementation-plan tasks and all required safety, CI, package, smoke, signature, checksum, integration and publication gates. The roadmap is closed. Stable release `v4.1.0` is published and is the current latest release.
