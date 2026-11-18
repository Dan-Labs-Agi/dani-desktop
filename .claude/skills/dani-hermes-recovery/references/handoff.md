# Historical DANI / Hermes takeover ledger

**Historical snapshot, superseded for current status by [latest-status.md](latest-status.md).** Later recovery closed several failures described below. Preserve this record for accountability and source pointers; do not treat its cancelled checks, unexecuted launcher, broker failure or GitHub-access observations as current conclusions without reconciliation.

## Authority and status

**STOPPED BY USER. NOT ACCEPTED AS A COMPLETE PRODUCT.**

The user stopped implementation, cancelled the current engineering goal, and requested a transferable skill and a detailed `/goal` prompt for another harness. This document records state; it does not authorize its author to resume implementation. The replacement harness needs the user's invocation of the supplied goal.

At stop:

- The active full native-policy check was cancelled. `.omb-scratch/native-browser-authority-green.json` was confirmed absent. There is no GREEN result for the latest alternate-browser policy edit.
- Both final workers acknowledged the stop and reported no owned active processes or checks.
- The latest owned PATH acceptance service was stopped. Its copied `auth.json` was replaced with `{}`. The original account was not changed.
- No current-candidate Electron acceptance launch occurred. The new desktop launcher exists as unexecuted source only.
- The latest reconnect smoke and Hermes Stop/new-bearer fixture still fail.
- No final integrated build, whole-candidate CI pass, fresh whole-product critic verdict, publication, installed upgrade, or production-readiness claim exists.

The historical task tracker has completed component tasks. Those are not whole-product acceptance. This ledger supersedes stale progress prose about what is currently ready.

## 1. What the user actually wants

The user repeatedly had to type “continue.” Their agent stopped after one unsuccessful browser action or after merely describing its next action. They want the purple Dani main agent to supervise workers until an accepted goal is genuinely finished, not abandon it when a worker returns or one tool fails.

The requested product is the real DANI desktop application, usable locally now, not another architecture essay, a mock harness, or just a browser demo. Web testing is permitted as supporting evidence, not as a replacement for desktop delivery.

### Runtime and models

- Hermes is the sole root agent-execution/coding harness, not another option beside other agent harnesses.
- The ordinary dropdown presents provider/model choices: OpenCode, Kilo Code, Dani Free, Claude, Codex/OpenAI, xAI, and all other configured provider/proxy catalogs.
- Hermes implementation branding and its CLI recovery commands should not leak into ordinary model selection/task UX. A legitimate model named `Hermes-4-405B` is a model, not a harness selector; do not remove genuine models by substring.
- Catalog discovery is not execution qualification. Expose truthful unavailable/configuration-needed states rather than pretending every listed model works.
- Preserve the exact selected provider, endpoint, protocol, model, credentials, tool calls/results and images. No silent fallback to another paid model or hidden nested agent.

### Autonomy and browser

- One accepted user request remains owned through worker results, recoverable observation failures, waits and restarts.
- The main Dani agent supervises assignments and verifies outcomes. A completed model turn or child assignment is not automatically a completed user goal.
- Browser-only work stays in the admitted Dani browser. No alternative browser, hidden npm browser install, shell/HTTP/Composio substitution, or stale “user owns control” explanation that contradicts actual state.
- Retry safe observations and recoverable transports with bounded policy and current state. Preserve completed work. Unknown consequential effects require reconciliation, not blind replay.
- Stop, denied permissions, real authentication prerequisites, human control, spending authority and irreversible actions remain hard boundaries. Long-horizon behavior is not permission to override the person.

### Delivery

- Demonstrate the actual Electron renderer, preload/IPC, backend, Hermes and managed browser together.
- Provide a current usable local artifact/URL with exact launch and stop instructions.
- Repair relevant CI/release logic, then prove a real authorized newer update if prerequisites exist. A source gate or older release is not an installed-upgrade proof.
- Use independent substantial parallel workstreams and a real builder/critic loop. The former harness allowed at most 32 simultaneous workers, so the earlier request for 50 required waves; worker count is not the success metric.

## 2. Environment and preservation boundaries

| Item | Recorded value / constraint |
| --- | --- |
| Repository | `/Users/dan/Desktop/x/daxxxx/dani-desktop` |
| Host | Darwin 25.6.0, x64 |
| Tooling observed | Node 26.8.1, pnpm 10.33.0 |
| Package version | `0.1.140-local.3` |
| Earlier branch/base | `fix/dani-onboarding-updates-compact-sidebar`, `3a7797656f` |
| Dirty starting tree | Earlier inventory already had 63 modified and 12 untracked files. This is historical, not a current diff or authorship inventory. |
| Managed native CLI | `/Users/dan/.hermes/hermes-agent/venv/bin/hermes` |
| Installed native source | `/Users/dan/Desktop/x/hermes-agent`, distribution Hermes 0.21.3, Python 3.11.15 observed earlier |
| Qualified command layout | POSIX `bin/hermes` with executable sibling `python3`, including PATH/symlink resolution. Windows/native command wrappers are explicitly not qualified in current production admission. |
| Existing browser assets | `dist-native/browser/darwin-x64/agent-browser` and `dist-native/browser/darwin-x64/chrome/chrome-headless-shell-mac-x64/chrome-headless-shell` |
| Browser versions observed | agent-browser 0.41.2; Chrome-headless-shell 153 |
| Original installed app | Originally on ports 8799/8800; do not stop, replace, or use it for mutation verification. |
| Original data | `~/.danibot` is protected live data. |
| Local workspace | `~/.danibot-local` became live when the user began real job applications. It is no longer a disposable fixture. Never resend those applications. |
| Native local profile | `~/.hermes/profiles/dani-local` contains real account state. Do not dump, replace, refresh through copied credentials, or change the global active profile. |

No commit, push, tag overwrite, remote setting change, or release publication was performed in this work. Preserve every existing change until its ownership and purpose are understood. Do not reset the tree or infer that an unfamiliar change belongs to the previous assistant.

`AGENTS.md` requires isolated verification through `docs/verification/README.md` and the shared control surface. Relevant nested policies must be respected by the new harness. The previous environment reported no configured language servers; that is not a claim about the replacement harness.

If moving to another machine, transfer the actual working tree, not only its old commit. `.omb-scratch/` and `.gauntlet/` may not travel with Git. Transfer only the named reviewed evidence, not an indiscriminate scratch/profile/archive copy. Exclude credentials, account stores, live databases and private browser profiles.

## 3. Recommended architecture; do not restart the design debate without evidence

### One owner per responsibility

| Responsibility | Owner |
| --- | --- |
| Native reasoning, coding/tool execution, model conversation/session history | Hermes |
| Original user-request identity, durable goal/assignment ledger, scheduling, recovery admission, authority and user-facing settlement | Existing Dani runtime/coordinator |
| Exact model/endpoint/protocol/credential transport | Transparent inference providers/proxies under Hermes |
| Browser session, live viewer, human ownership, effect admission, cancellation and uncertain-write reconciliation | Dani managed browser/broker |
| Window, preload, IPC, local server lifecycle, packaging and updater | Electron/application layer |
| Code improvement and independent acceptance | Engineering Gauntlet, separate from product runtime |

Keep the installed direct ACP path as the near-term integration unless a pinned replacement experimentally removes complexity. ACP `end_turn` is not a persistent goal-completion contract.

A newer upstream Hermes gateway is a legitimate research candidate, not an already integrated solution. It moves execution into a daemon: the existing bootstrap patches in an ACP child would not protect that daemon. A migration must move policy to the real execution owner, prove session/cancellation/approval/effect contracts, and remove the superseded path. Do not stack Dani scheduling, native GoalManager and another job system on the same goal.

Retaining native coding/terminal tools is intentional. A native tool allow/deny fence is not an OS sandbox for arbitrary code. Browser-only profiles have the stricter broker boundary. Do not advertise universal effect brokering or autonomous high-impact safety when native code can bypass it.

## 4. Source map and implemented changes before stop

These are integration pointers, not a claim that every file currently passes the final acceptance gate.

### 4.1 Native runtime command admission — focused GREEN, integration review still outstanding

Files:

- `server/drivers/acp/hermes.ts`
- `server/drivers/acp/hermes.test.ts`
- Existing snapshot extension point in `server/drivers/acp/core.ts`

`managedHermesPython()` resolves the configured command using the effective environment/PATH, checks the first executable candidate, follows the Hermes executable symlink, requires the supported POSIX layout, and preserves the sibling venv Python path. It rejects wrappers/fixed extra arguments, unsupported executable layouts, and Windows. Metadata and task execution now share that resolver; the old raw-CLI production fallback was removed.

The new `support.snapshot` invokes that same interpreter with the Dani bootstrap `--version`, requires 0.21.3, and returns unavailable on failure. It no longer trusts a CLI banner from a different installation. The first regression returned `available` even though its interpreter announced another native version; after the fix all 33 tests in `hermes.test.ts` passed.

Evidence:

- `.omb-scratch/hermes-command-admission-red.json`
- `.omb-scratch/hermes-installation-readiness-red.json`
- `.omb-scratch/hermes-interpreter-readiness-red.json`
- `.omb-scratch/hermes-unified-admission-green.json` — 33 passed

A subsequent test-only missing `displayName` was corrected. An intermediate `pnpm typecheck && pnpm lint` later passed. These facts do not qualify an untested Windows install or the entire final product.

### 4.2 Native sessions, protocol and tool mounting — prior evidence, latest policy changed afterward

Files:

- `server/drivers/acp/hermes-bootstrap.py`
- `server/drivers/acp/hermes-policy.test.ts`
- `server/drivers/acp/hermes-qualification.ts`
- `server/drivers/acp/hermes-model-metadata.py`

Established causes and repairs:

1. Restored native Codex ACP sessions could retain `chat_completions`, producing a 404 against `/backend-api/codex/chat/completions`. The exact native ChatGPT Codex endpoint requires `codex_responses`.
2. Native 0.21.3 `session/set_model` reconstructs an agent from profile toolsets and can drop session-mounted MCP tools. A cached catalog could still list coordination tools that the actual agent no longer had.
3. The Dani session manager preserves explicit same-session `mcp-*` toolsets through reconstruction using native MCP refresh, without importing sibling-session tools.
4. Model selection is applied before initial/restored construction when required; unrelated saved defaults are not fallback authorization.
5. Provider/model qualification is a harmless native structured tool/result nonce challenge. Metadata discovery is read-only and must not start inference or mutate account stores.
6. The existing browser-only constructor/dispatch fence admits only the session-scoped Dani browser MCP. Its isolated native profile requires tool search off. It suppresses profile MCP servers that could claim the managed browser name.

Earlier evidence includes `.omb-scratch/native-session-tools-green.json` (10 native policy tests), `.omb-scratch/native-provider-admission-check.json`, and the native supervised workflow below. Do not use the earlier 10-test result as GREEN for the now-11-test policy file.

### 4.3 Newly discovered competing native browser — production edit exists; GREEN cancelled

The real PATH workflow finished its workboard effects, but its full supervisor invoked native `browser_navigate` outside Dani's managed browser. That attempted an npm installation of agent-browser and failed certificate validation. It later recovered through the worker and vision evidence. This is a real boundary failure, not a hypothetical code-review concern.

A new regression against the installed native Python failed with:

`AssertionError: full agent admitted native browser`

Evidence: `.omb-scratch/native-alternate-browser-red.json`.

The newest `hermes-bootstrap.py` now:

- Builds a dedicated disabled toolset from exact native browser registry identities.
- Preserves full native coding tools and existing disabled toolsets.
- Avoids disabling bare `browser`, because Hermes 0.21.3 aliases that to `mcp-browser` and would also remove the legitimate Dani mount.
- Fails constructor admission if forbidden native browser tools remain.
- Denies restored/injected native browser identities and resolved Tool Search dispatch by registry identity, not a `browser_*` string heuristic.
- Leaves the stricter browser-only fence in place and does not claim an OS sandbox.

The new regression covers default/full constructors, terminal/read_file/patch retention, a real harmless native file read, native MCP alias collision, model rebuild/MCP refresh, restored catalogs, a newly registered browser tool with a non-browser-prefixed name, and deferred Tool Search.

**The full native policy run was cancelled by the user's stop. Its planned GREEN JSON is absent. The edit has not received a fresh post-fix independent verdict or a new real assembled workflow.** The next harness must inspect the exact implementation and execute the focused gate, not assume the worker's source report is acceptance.

### 4.4 Durable owner, cancellation and restart settlement — previous tested repairs

Files:

- `server/drivers/acp/turn-state.ts`
- `server/turn-outcome.ts`
- `server/index.ts`
- `server/runtime/runtime.ts`
- `docs/runtime-contract.md`

Native cancellation is no longer reported as successful completion. `blockingTurnStop` uses typed outcomes: denial and known uncertainty outrank interruption; it does not infer authority from prose. A host interruption is not automatically an eligible generic transient retry.

`restoreDirectRequestOwner()` restores an exact persisted person/chat requester and accepted answer chain on a resumed root. It does not guess ownership from message similarity/timestamps, revive superseded requests, override a proven owner, or adopt unrelated group/goal/steered/relayed sources. This repairs final settlement of the original `requestPending` state after Chief restart.

During shutdown only, interrupted teardown is reconciled on next open rather than incorrectly parked as a new user-input requirement. Existing denials, uncertainty and real cards remain blockers. Outward evidence prevents unsafe replay; explicit Stop remains terminal.

Earlier artifacts:

- `.omb-scratch/native-cancellation-truth-green.json`
- `.omb-scratch/native-cancellation-host-green.json`
- `.omb-scratch/chief-restart-settlement-green.json`
- `.omb-scratch/shutdown-cancellation-reconciliation-green.json`

There is no claim that one generic outward-effect classifier detects every possible action performed by arbitrary native code.

### 4.5 Model catalog and compatibility work — do not confuse listed with usable

Relevant files:

- `server/drivers/acp/hermes-model-catalog.ts`
- `server/drivers/acp/hermes-configured-providers.ts`
- `server/drivers/acp/hermes-provider-env.ts`
- `server/drivers/acp/hermes-model-metadata.py`
- `server/cli-api-setup.ts`
- `src/components/ModelPicker` implementation/tests, discover exact current files
- `docs/verification/local-hermes.md`

Prior real picker inspection showed provider groups including Codex, xAI, Claude, OpenCode, Kilo Code and others, a searchable catalog, and no Hermes engine choice. A real Hermes-named model remained. A read-only API snapshot listed 7,391 catalog choices, not 7,391 usable models. At that snapshot, OpenCode 110, OpenCode Go 46, Kilo 397 and Dani Free 26 entries were unavailable.

Four authenticated Codex routes were genuinely qualified through native structured tool/result consumption: GPT-5.6 Sol, Astra, Terra and Luna. This does not prove every model's visual grounding or arbitrary long-horizon quality. Only the selected Sol route was used in the described supervised browser scenarios.

Known incompatible routes:

- Old loopback 4187 runs another OpenCode agent and drops caller tool schemas/choices/results/images. It is not a transparent inference proxy.
- 4190's silent model fallback violates exact selected-model behavior.
- A previously configured Pi route on 18900 was offline at observation time.
- Claude subscription credentials are not authorization for arbitrary third-party Anthropic API requests; API-key configurations are a separate supported route.

Read-only native metadata/account protections had prior focused coverage. Anthropic model discovery was repaired to paginate with same-origin cursors, deduplication and one bounded deadline; incomplete discovery fails rather than falsely presenting a complete catalog. Relevant prior GREEN: `.omb-scratch/provider-catalog-closure-green.json` (88 tests).

Do not rerun paid qualification merely to browse a model list. Do not share another model's successful nonce proof with a changed provider/model/endpoint/protocol/credential contract.

### 4.6 Legacy package migration and release gates — prior focused GREEN, not final CI

Historical v1 packages serialized `maus`; an earlier rename had changed schemas without a format-version change. Repairs accept historical input, normalize imported current values to `dani`, preserve the strict current v2 schema, and serialize v1 back to its historical contract. Original release bytes/SHA remain authoritative for catalog identity.

Files include `shared/package-format.ts`, `server/package-export.ts`, `server/org-library.test.ts`, existing package/import fixtures and `docs/team-sharing`. The most recent small test correction narrows optional `installId` before indexing the stored installation. Prior migration gate: `.omb-scratch/legacy-package-compatibility-final-green.json` — 169 tests across six files.

`scripts/release-ci.mjs` was repaired so an actual failed candidate test result cannot be bypassed by an older green result, identical-tree/version-only parent, or dispatched lane. Prior gate: `.omb-scratch/release-phase-five-source-gates.json` — 162 tests. These are source/release-policy tests, not proof of a published updater working on a user's installation.

## 5. Native execution evidence and its exact limits

### Earlier native supervision 152

`.omb-scratch/native-supervision-152-proof.json` records a genuine Hermes/Codex/managed-browser workflow in a separate private fixture:

- One original user request and a forced backend restart.
- Inspection worker executed twice, with one restart; the Chief resumed automatically.
- Worker used only mounted browser MCP; the deliberately missing selector was attempted once and followed by a fresh observation.
- Ada completed, Grace and Linus active, All 3 / Active 2 / Completed 1, independent receipts and zero duplicate writes.
- Original request was no longer pending at completion.

It is a useful regression baseline, not proof that subsequent source/desktop changes passed. Earlier runs 150/151 had different defects/termination observations; do not launder them into 152 or into an active-Stop proof.

### Latest default/PATH workflow, round 1

Portable summary: `.gauntlet/native-path-round1.json`.
Raw export: `.omb-scratch/gauntlet-native-path-export/`.

- Fixture home: `/tmp/dani-native-acceptance-z25YTK`.
- Former app URL 8885, workboard 8887; the service has now been stopped.
- Runtime configured with bare `hermes` on PATH; snapshot actually reported 0.21.3 and the real native model ran.
- Root: `063526ff-31c2-4908-8b1c-ac38157ea840`.
- Chief thread: `68d8dc31-703b-49b3-94e0-8f55eef0ffc5`.
- Original request: `e1b5af66-74b1-4625-a1e5-50dccaa6e59b`.
- Exactly one user message; exported `requestPending: false`.
- Chief executions 4; inspection worker executions 2; backend restart confirmed.
- Independent ledger: Ada completed, receipt `f3c0876f51c7`; Grace active, `7aa52fd1a6e9`; Linus active, `d42f7feb7d7c`; zero duplicate writes.
- CLI completed in about 326 seconds. This is not a latency target or a performance PASS.
- **Overall round rejected** because the supervisor's native alternate browser was admitted. See section 4.3.

The export includes an image-bearing vision tool result. Query only needed fields or bounded output prefixes; dumping its full base64 consumes context without proving anything further. The vision result loaded the image into the selected model's context; it should not be misrepresented as an observed fallback to another paid model.

The copied access-only auth file for this latest fixture was wiped to `{}` after the service stopped. The older 152 auth-file path was checked at handoff and was absent; do not invent its current existence or perform broad temp cleanup.

## 6. Current browser verification failures

### Actual scope that previously passed

Before the latest edits, real native browser evidence included:

- `.omb-scratch/browser-acceptance-gate.json`: four physical scenarios — core MCP schema; local auth/cookie plus human hand-back and one Save; stale reference without unintended write; dropped acknowledgement with exactly one accepted command/POST and refused replay.
- `.omb-scratch/browser-physical-stop-acceptance.json`: accepted delayed submission stopped while another browser remained functional. The browser/effects were real; the model was scripted.
- Earlier fault suites had additional ownership/lease/cancellation coverage. Do not claim their counts prove the final assembled application.

### Reconnect/65-second native smoke: NOT PASSING

Files:

- `scripts/verify-browser-live.ts`
- `scripts/testing/browser-recovery-smoke.ts`
- `src/lib/browser-stream-v1.ts`
- `src/components/BrowserPanel.test.ts`
- `docs/verification/browser-live.md`

An isolated Playwright 1.65.0 package was installed only under `.omb-scratch/browser-verification/`, with scripts disabled. No project/global dependency or browser download was required. It drives the existing explicit Chrome binary.

The successive failures were not all production defects:

1. Fixture navigation failed with `net::ERR_SOCKS_CONNECTION_FAILED`. The isolated server had not explicitly allowed the fixture's private preview host/port. The launcher now grants only that exact loopback host/port through the existing egress configuration; production network controls were not weakened.
2. A brittle test expected exactly `take,navigate`, but a legitimate viewport `resize` also occurred. It now checks one take and one navigate rather than pinning every incidental request.
3. Instrumentation used `endsWith('/browser/live')` and missed the real stream's query parameters. It now checks URL pathname.
4. The smoke now waits for an actual frame on a replacement EventSource, rather than a transient UI phrase or only counting constructor calls.
5. **Latest unresolved failure:** after a real replacement stream/frame, `[data-pill="yours"]` count was **1**, while the smoke expected **0**. The assertion fails at about line 90. The 65-second identity/form-survival assertions were not reached.

Latest retained native fixture log:
`/var/folders/nq/193tn3ds45lbjh8nr6_pfx700000gp/T/danibot-verification-evidence/server-1794597571367-62714.log`.

The unresolved question is authority semantics, not just test syntax. The stream has an explicit `resume=<old-viewer>` protocol. Determine whether an owned human session should resume its valid lease, versus an anonymous observer returning watch-only. Preserve explicit hand-back and expiry and ensure merely opening/reconnecting a watcher cannot steal control. Do not change the expected assertion to match current behavior or automatically release human control without resolving the intended product/security contract.

Useful future command, not executed after user stop:

```sh
OMB_VERIFY_BROWSER_BINARY="$PWD/dist-native/browser/darwin-x64/agent-browser" \
OMB_VERIFY_BROWSER_CHROME="$PWD/dist-native/browser/darwin-x64/chrome/chrome-headless-shell-mac-x64/chrome-headless-shell" \
OMB_VERIFY_PLAYWRIGHT="$PWD/.omb-scratch/browser-verification/node_modules/playwright/index.mjs" \
node --experimental-strip-types scripts/verify-browser-live.ts --recovery
```

## 7. Current CI fixture failure and prior checks

### Hermes Stop/new-bearer fixture still fails

File: `server/comms.test.ts`.
Test: `keeps DaniBot tools authorized for Hermes after Stop issues a new bearer`.
Latest report: `.omb-scratch/gauntlet-bearer-round4.json`.

It times out waiting for the **first** `peers:` reply. Therefore it has not reached Stop or the post-Stop authorization assertion. No root cause for the remaining timeout was established before the stop.

The fixture uses an isolated real server, Hermes adapter and agents broker, but synthetic native metadata/qualification/inference. Its POSIX `bin/hermes` and sibling `python3` are copied Node executables with a fixture preload. Raw CLI execution intentionally throws; metadata, version, runtime identity, qualification and ACP dispatch are intercepted. This is not real-provider proof.

Problems already corrected in the fixture:

- Unsupported Windows success-path assumptions; the test now follows existing POSIX-only qualification.
- Using public `activeTaskId` where the response has `threadId`.
- Attempting to archive/hide the protected default Dani through an invalid API mutation; that unnecessary setup was removed.
- Requiring every bot's transient `busy` field, although `shared/wire.ts` makes it optional; the schema is now optional.

Current success predicate is still `texts.length === count && current?.busy === false`. Diagnose the actual send acknowledgement, native runtime/metadata/preload path, transcript, and public idle semantics. The captured `errors` string in the poll label can be stale because the message is constructed before later errors arrive. Do not keep changing fields blindly or lengthening the timeout.

Future focused command:

```sh
pnpm exec vitest run server/comms.test.ts -t 'new bearer' --maxWorkers=1
```

### Other targeted CI repairs

- The safe-operator Chief fixture now seeds its owned fake Grok auth/catalog/default. Its omitted model selection really inherits a ready default, rather than passing empty model IDs to `create_bot`. That targeted case passed in round 2.
- A separate production seam was observed but not changed: `create_bot` with an unavailable workspace default may surface a generic schema error from empty IDs instead of an actionable setup refusal. Confirm relevance before changing production; do not hide it with a fake fixture default in a negative case.
- The direct-coordination loopback provider now parses JSON only for its actual POST chat-completions route. An empty-body GET version probe no longer creates an unhandled rejection.
- Targeted direct capped-work/provider-save cases passed after that correction.
- Three delta-context restart/notification cases and the macOS permission-propagation case passed their targeted checks.

Reports:

- `.omb-scratch/gauntlet-ci-contracts-green.json` is **FAILED despite its filename**: 2 failed tests and 2 unhandled errors. Parse report content, not filenames.
- `.omb-scratch/gauntlet-ci-round2.json`: 4 passed, 1 failed; the remaining failure was the protected Dani setup mutation, since removed.
- `.omb-scratch/gauntlet-bearer-round3.json`: optional busy-schema failure.
- `.omb-scratch/gauntlet-bearer-round4.json`: first-reply timeout, unresolved.

An intermediate `pnpm typecheck && pnpm lint` passed after fixing the missing `displayName` and optional installation ID. Later source/test edits exist. This was not a final whole-candidate gate. Lint previously emitted no reported warnings in that completed run; a Vitest runner deprecation warning remains observed in test output and was not suppressed.

Earlier work had broad partial results, not a clean overall CI run: an API suite had 313/322 passing before targeted fixes; remaining targeted cases later passed but no final 322/322 run was recorded. A broad integration batch timed out; a later isolated live-call suite passed all 18 cases, without proving the original batch-hang cause. Do not convert these facts into an aggregate global PASS.

## 8. Desktop candidate and isolation risk

### Existing built artifact is stale and unexercised

Path:
`.omb-scratch/desktop-acceptance/mac/Dani Acceptance.app`

An earlier command successfully built UI/server/companion/updater and an x64 mac directory package with unique app identity:

```sh
pnpm build && pnpm build:server && pnpm build:companion && pnpm build:updater && \
pnpm exec electron-builder --mac dir --x64 --publish never \
  -c.directories.output=.omb-scratch/desktop-acceptance \
  -c.appId=com.danibot.acceptance \
  -c.productName='Dani Acceptance' \
  -c.extraMetadata.name=danibot-acceptance
```

It predates later production/source changes. electron-builder automatically used a local **Apple Development** certificate. That is not Developer ID/notarized distribution proof. No original application was installed over.

### Source-only smoke-mode changes

`electron/main.mjs` currently recognizes `OMB_SMOKE_TEST=interactive` for isolated acceptance:

- Protocol registration is skipped for smoke modes; duplicate normal registration was consolidated.
- Interactive mode skips updater startup.
- These later changes are not in the stale artifact and have not had actual native surface proof.
- Interactive mode still starts real-computer CUA normally. Its mere use is not isolation.

### Independent source review found important risks

Temporary dataDir/userData alone was insufficient:

- An absent data target can trigger legacy data migration; precreate an owned empty target.
- Logs/downloads/home/provider/browser/socket paths are separate boundaries.
- Real CUA startup can request OS permissions or fall back to the installed CuaDriver.
- The child inherits environment unless the launcher supplies a minimal one.
- `--user-data-dir` must be checked against actual resolved Electron paths, not assumed.
- A unique bundle identity and direct executable launch are necessary; avoid the installed app name/port as an implicit selector.

No operational PASS was issued by that source review.

### New desktop launcher exists but has never run

Files:

- `.omb-scratch/gauntlet-desktop-fixture.mjs`
- `.omb-scratch/gauntlet-desktop.sb`

Intended boundary:

- Fresh private HOME, data, userData, logs, downloads, runtime, socket and native profile directories.
- Only unexpired Codex access-pool records copied, with refresh tokens stripped; no credential values printed. Saved qualification may be reused when compatible.
- Minimal environment with HOME/CFFIXED_USER_HOME and explicit owned data/profile paths.
- macOS `sandbox-exec` denies original-home writes, most original-home reads, bundled/installed CUA access, and keychain broker access; read-only exceptions for the candidate and installed Hermes code.
- Real Electron security, renderer/preload/backend/Hermes/browser retained. No `--no-sandbox`, mock keychain, or Playwright Electron loader.
- Main inspector pauses startup to check resolved paths before resuming. CDP and actual backend/utility process identities are supposed to be verified before a ready result.
- Own loopback workboard/ledger. Owned PID/start-time and socket-based cleanup; copied credential profile removed on cleanup.

**All of that is intended source behavior, not operational evidence.** It may fail, over-restrict necessary resources, or have lifecycle defects. Read and qualify it before use; simplify if warranted. No candidate was launched through it, no fixture-ready output exists, and no model/browser task ran in it. It is a throwaway proof aid, not a new product runtime.

The native CUA feature is deliberately unavailable in this browser/coding acceptance boundary. That cannot count as real-computer/CUA acceptance. Likewise a macOS run does not qualify Windows.

## 9. Local services and live workspace status

- `DaniHermesLocal145` previously served UI 8811, backend 8812 and webhook 8813 with `~/.danibot-local`. Its service registration later reported exited. The final source was not deployed/qualified there. Verify current ownership/readiness before any later intentional deployment; do not mutate it as a test fixture.
- `NativeSupervisionAcceptance152` also reported exited. Its earlier evidence survives, not a live service guarantee.
- `GauntletNativePathAcceptance` was explicitly stopped after its completed test. Its fixture access-token copy was wiped.
- The native desktop candidate/launcher was never started in the latest work.
- Browser smoke launchers closed their owned browsers/fixtures on the reported failures. Their retained evidence logs are separate from the disposable data roots.

Do not use broad process-name kills or assume an old PID is still owned. If a registration says exited, that is not proof about every descendant. Establish ownership before cleanup/deployment, without touching the original app or live work.

One earlier intentional live ownership migration had exact host proof for root `103629ff-16b9-4a79-80e7-29ff001bbe83`, message `42dc159b-def1-421d-8293-f6b35627cf45`, sendId `0d77995d-5148-45ad-8c7e-ce40d110eec3`. Backup was `~/.danibot-local/runtime-before-owner-binding-145.db`. It preserved waiting/Full/execution state. Do not reapply it from this prose or revive superseded root `151187c5…`; no new live-data migration is authorized by a test goal.

## 10. Release/update prerequisites and source gates

Prior read-only GitHub observations:

- Accessible repository and organization secret-name inventories returned zero.
- Actions settings permission request returned 403.
- A historical release PR creation attempt was denied.
- Latest published release was browser-only; public desktop 0.1.58 was older than local 0.1.140-local.3.
- Existing `release/v0.1.140` pointed to another candidate (`8bf0824…`); do not overwrite or assume it names this work.

Those are observed access/release limitations, not proof that no administrator anywhere has secrets. Recheck only as needed under actual authority. Do not print secret values.

A real update PASS requires an authorized newer correctly signed candidate, appropriate manifests/assets, discovery/download validation, install/relaunch, and preservation of provider/settings/data. On macOS, Developer ID/notarization/ZIP-manifest requirements must match the actual updater. On Windows, native NSIS/manifest/installed-upgrade proof needs an actual target. Source tests, an Apple Development signature, a package directory, or an older release cannot substitute.

Publication, credential provisioning, remote permissions and signing-account changes remain human authorization gates. Complete reachable local work and name the precise external gate; do not call a locally green branch a functioning shipped auto-update.

## 11. Mistakes made by the previous assistant

This section is accountability, not a claim that every observed failure was a product bug.

### A. Delivery and prioritization

1. I produced substantial activity without delivering one current, verified, usable end-to-end desktop build. The user asked for a working agent, not accumulating fixtures and status reports.
2. I allowed test-fixture repair and tooling setup to dominate the loop before closing the actual user-facing vertical slice.
3. I had a built but stale/unexercised desktop candidate and an older local service. Neither justified a current delivery claim.
4. I did not finish a fresh independent post-fix whole-product verdict. Earlier component checks and task-completion labels were too easy to read as broader completion.
5. I did not establish a measured latency/resource bar for the user's “quickly” requirement. The latest real supervised toy task took roughly 326 seconds; no performance improvement claim is justified.

### B. Missing runtime/boundary coverage

1. The default/PATH route and explicit managed path had different admission behavior. A raw CLI path could bypass the intended native bootstrap.
2. Readiness trusted a CLI banner rather than the Python environment that would actually execute the task.
3. Effective native MCP inventory after model reconstruction was not proved by a cached tool list.
4. Browser-only worker coverage did not prove that the unrestricted supervisor had no competing browser. The real task exposed a native browser/npx path only later.
5. Retry policy was not a replacement for fixing a wrong provider endpoint/protocol. Repeating deterministic 404s wastes attempts and does not make an agent resilient.

### C. Verification mistakes and incomplete loops

1. I advanced through a sequence of fixture/API mistakes instead of reading the complete current public contract first: activeTaskId versus threadId, optional busy state, protected Dani mutation, and fake-provider readiness prerequisites.
2. The reconnect smoke had stale assumptions about egress admission, request ordering, URL queries and transient wording. Those were verification defects, not evidence that every corresponding product surface was broken.
3. The latest reconnect assertion exposed an unresolved human-ownership contract. It would be wrong to force a test pass by simply removing the assertion or silently taking control away from a person.
4. I introduced a missing required `displayName` in a new test. The optional installation ID indexing issue also needed correction. The later intermediate typecheck/lint pass does not erase the need for final verification.
5. A report filename containing `green` held failed results. Evidence must be read, not inferred from names.
6. I opened guessed nonexistent paths during investigation. The replacement should discover paths before reading and use actual public schemas rather than guessing field names.
7. I did not capture sufficiently current diagnostic context in the remaining broker reply timeout; the poll label can miss later server errors.

### D. Orchestration and architectural discipline

1. Parallel agents are useful only with disjoint boundaries and an integration owner. More agents or more tests do not compensate for an unverified product boundary.
2. The engineering Gauntlet and the product's durable goal runtime are separate systems. A long prompt does not itself create persistence, retries, a supervisor, or a safe infinite daemon.
3. “Never stop” must mean continue authorized reachable work, not ignore Stop, deny a human hand-back, replay unknown writes, spend indefinitely, or conceal blockers.
4. The latest native-browser fix and desktop isolation launcher are proposals in source until exercised. I must not transfer them as already verified solutions.

The correction is a narrow evidence loop around the real application: one coherent candidate, explicit authority, actual effects, fresh independent critique, then verified local delivery. Preserve useful existing work without defending an unproved implementation.

## 12. Exact first work for the replacement harness

These are future tasks for an authorized new owner, not commands executed by the stopped assistant.

1. Read this ledger, the skill, current repository policies and verification guide. Inventory current source/artifact/process ownership without changing live data. Give the user a short concrete plan, then act.
2. Inspect the latest native alternate-browser fence and run the 11-test native policy file using the qualified interpreter. Keep the observed RED and verify coding/MCP alias/restore/deferred dispatch behavior. A regression in coding or managed MCP is not an acceptable fix.
3. Resolve the browser reconnect ownership contract using the actual resume protocol and real surface; then finish its replacement-frame and 65-second unsaved-form proof. Diagnose the real broker fixture's first reply rather than patching another guessed field.
4. Freeze one candidate, build it, qualify a safe actual Electron launch, and perform both a native coding task and a supervised browser task with independent receipts. Verify picker availability and error UX there. Do not run all model catalogs as inference probes.
5. Finish coherent relevant CI/build/package gates, obtain fresh blind/integration critics, deliver the actual local artifact, and prove updates only when authorized prerequisites exist. If publishing is externally blocked, report that separately from achievable local functionality.

Native policy command:

```sh
DANI_HERMES_POLICY_PYTHON=/Users/dan/Desktop/x/hermes-agent/venv/bin/python3 \
pnpm exec vitest run server/drivers/acp/hermes-policy.test.ts --maxWorkers=1
```

Read `package.json` for current canonical typecheck, lint, agent, Electron, packaged-server and build scripts rather than trusting cached command aliases. Run checks after exclusive owners freeze the relevant slice. No final PASS until the exact assembled artifact satisfies every required gate.

## 13. Primary-source research already done

Use pinned implementations and actual installed behavior, not only rolling docs:

- ACP prompt turns: https://agentclientprotocol.com/protocol/v1/prompt-turn
- Native goals at the researched older pin: https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/website/docs/user-guide/features/goals.md
- Newer gateway command source at a different, unqualified pin: https://github.com/NousResearch/hermes-agent/blob/72c880370ff2e47dd587982ddded1b1ce90cfde4/gateway/session_commands.py
- Gateway local sessions: https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-local-sessions
- agent-browser changes: https://agent-browser.dev/changelog
- Reference lifecycle: https://agent-browser.dev/snapshots#ref-lifecycle
- Browser session behavior: https://agent-browser.dev/sessions
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron automation: https://www.electronjs.org/docs/latest/tutorial/automated-testing
- Updater reference: https://www.electron.build/features/auto-update/
- Retry/idempotence semantics: https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2
- Gauntlet method: https://somethingbig.ai/gauntlet-loop

The installed direct ACP integration is not automatically native persistent-goal mode. Newer rolling gateway docs/source and current agent-browser/Electron-builder features may differ from installed pins. The project previously declared electron-builder 26.x/updater 6.x; do not assume newer documented features ship here. Local deduplication keys cannot guarantee remote exactly-once effects.
