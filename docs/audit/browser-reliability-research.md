# Browser reliability: driver, agent loop, and verified effects

Research date: 2026-11-12. Sources below are official documentation, tagged source, or immutable source revisions. Research did not open a personal browser, profile, account, or installed-app workspace. The existing integration was agent-browser **0.37.0** on macOS/Linux and **0.36.0-omb.1** on Windows; a source comparison is not native qualification.

## Findings that change the implementation

1. **The current automatic navigation observation loses task evidence.** `BrowserRuntime` requested `{compact:true}`, while the pinned MCP `call_snapshot` defaults `interactive` to true. The pinned renderer filters static text but can retain headings. Consequently, a receipt page can report its heading without its receipt identifier. The parent-run real-browser regression reproduced exactly this: `Draft saved` appeared, `Receipt fixture-482 is ready.` did not. The repair explicitly requests `interactive:false`; the permanent regression uses actual Chrome and the runtime, not an assertion about forwarded arguments. [Pinned MCP schema/default](https://github.com/vercel-labs/agent-browser/blob/v0.37.0/cli/src/mcp.rs#L840-L850), [pinned snapshot rendering](https://github.com/vercel-labs/agent-browser/blob/v0.37.0/cli/src/native/snapshot.rs#L1091-L1126).
2. **0.37.0 can replay a write below Dani's retry policy.** Its `send_command` retries up to five attempts on EOF/reset/read errors after `write_all`, without distinguishing mutations. Upstream explicitly fixed duplicate click/fill/eval/navigation execution in **0.39.1**, returning `outcome_unknown` after any request bytes were sent. The host cannot prevent that old CLI's internal replay by merely declining an outer retry. Native `outcome_unknown` must also retain Dani's uncertainty fence before result shaping removes structured content. [Pinned transport](https://github.com/vercel-labs/agent-browser/blob/v0.37.0/cli/src/connection.rs#L1019-L1128), [merged fix #2085](https://github.com/vercel-labs/agent-browser/pull/2085), [changelog](https://agent-browser.dev/changelog).
3. **Current web documentation is not the pinned contract.** Persistent refs arrived in **0.38.0**; ambiguous stale-ref recovery and hidden/disabled/offscreen click false-success fixes arrived in **0.39.2**. The 0.37 ref map clears and resets its counter, so taking an unseen helper snapshot can invalidate a model's refs. Preserve the existing non-snapshot eval observations; obtain a new model-visible snapshot after navigation, DOM replacement, tab/frame changes, or browser replacement. Never infer current ref behavior from the latest website. [Pinned ref map](https://github.com/vercel-labs/agent-browser/blob/v0.37.0/cli/src/native/element.rs#L112-L116), [versioned changes](https://agent-browser.dev/changelog), [current snapshot semantics](https://agent-browser.dev/snapshots).
4. **A browser driver cannot fix an agent that elects to stop.** The driver executes calls; Hermes owns goal pursuit. The inspected Hermes revision includes browser tools in `hermes-acp`, while excluding computer-use and clarify. Its browser documentation defaults to `browser_exec` when browser-use is runnable and terminal access exists, otherwise built-in tools. This is a different surface from Dani's `agent_browser_*` MCP mount. The actual selected Hermes executable, admitted tool schemas and serving-path calls must be captured; another checkout's documentation or a deterministic CLI fixture does not prove installed native-model behavior. [Pinned toolsets](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/toolsets.py#L184-L190), [pinned browser selection](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/website/docs/user-guide/features/browser.md#L72-L100), [ACP MCP admission](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/acp_adapter/session.py#L392-L400).

Recorded parent-run RED evidence: the actual 0.37.0 lost-acknowledgement
regression observed **five accepted click commands where one was required**;
the native `outcome_unknown` runtime regression observed an unlatched
uncertainty gate. These are browser/runtime defects, not proof of the separate
live-model stopping cause. Candidate GREEN, native Windows qualification and
installed-app deployment must be reported separately.

## Upgrade decision and compatibility gates

**Selected source pin: official 0.41.2, across all existing targets.** This is the minimum compatible candidate identified for native qualification, not a claim of installed-app deployment. It includes the no-resend fix, stale-ref/click corrections, MCP access-limit corrections (0.39.3), flag-injection fix (0.41.0), selector-wait validation (0.41.1), and retained-profile/bare-open/session-timeout fixes (0.41.2). Its source includes bounded Windows MCP pipe draining and private headless desktop support; that does not replace native Windows cold-start/close-reopen/Stop qualification. [0.41.2 release and official asset digests](https://api.github.com/repos/vercel-labs/agent-browser/releases/tags/v0.41.2), [MCP source](https://github.com/vercel-labs/agent-browser/blob/v0.41.2/cli/src/mcp.rs), [transport source](https://github.com/vercel-labs/agent-browser/blob/v0.41.2/cli/src/connection.rs).

The latest official release examined, **0.42.0**, adds four saved-flow tools to `core`, including HTTP/browser replay. It is not an equivalent least-change catalog upgrade: using it requires explicitly excluding or separately authorizing that new surface. No engine switch or provider change follows from this research. [0.42.0 catalog](https://github.com/vercel-labs/agent-browser/blob/v0.42.0/cli/src/mcp.rs#L350-L384), [release](https://github.com/vercel-labs/agent-browser/releases/tag/v0.42.0).

Affected release boundaries: `server/browser-engine-release.ts` (seven assets, sizes and digests), `Dockerfile`, derived desktop bundle manifests, third-party provenance/notices and release tests. The existing optional Windows vendor build must not remain the runtime resolver's old replay-vulnerable exception. Browser-only dependency releases must never replace the desktop application's GitHub latest release. Qualification must use downloaded bytes matching the pin, not merely an npm package name or source tag.

All seven official 0.41.2 executables were downloaded and hashed during this
research; their byte counts and SHA-256 values matched the release API. They
were not executed or installed by the research worker.

| Target | Bytes | SHA-256 |
| --- | ---: | --- |
| darwin-arm64 | 16068000 | `19680f06cf87d0095c318a2e80bea6b71523d95d3b651cd18d81885cd182477a` |
| darwin-x64 | 17761648 | `fc55608c2222650e6e0d0154f9edebd203b63bf853b85d22240bfbddbb006ea1` |
| linux-arm64 | 16108464 | `00d291f45e1c4d527b3aa08c70c54c7c3030fde0794f8d4575aaa3ca1680f728` |
| linux-musl-arm64 | 15924440 | `730a5168153e27ad1243ebe960157e69de0f24531fbbac9a040856a491bf491f` |
| linux-musl-x64 | 18434688 | `5d452d57772330fe4cef9b7aeb5e7137890dde20bbb65e82b990e0bc0b35d9cd` |
| linux-x64 | 18626776 | `c4351f3802ffa5254d8c69f20a52e2fcf56925c6016fcf4203db25a07d811379` |
| win32-x64 | 18248192 | `c2eadee7b67e326dfff02d5dd51a16ce7673eb165699d134b3ea5f05b4a7a9d0` |

The three bundled upstream notice files were hashed against the 0.41.2 sources
and match byte-for-byte: Apache license
`014bb31e83d5c2e76aea1cc6e82217346ab41362f32cb355ad0f5c10aa0aeaff`,
axe license `af175b9d96ee93c21a036152e1b905b0b95304d4ae8c2c921c7609100ba8df7e`,
and axe third-party notices
`cadf92d5df0bf94bb4d74f906d5207f6198923e4f96aff0b6793d793f5f80e77`.
[Apache source](https://github.com/vercel-labs/agent-browser/blob/v0.41.2/LICENSE),
[axe sources](https://github.com/vercel-labs/agent-browser/tree/v0.41.2/cli/src/native/a11y).

### Advertised schemas and outputs

The 0.37 source `core` profile contains **29** tools. Dani adds upload, hover and restart; it removes harness-owned launch/session arguments and URL-bearing `read`. Core offers selector/text/load waits, **not** `find`, URL/function waits, or the full CLI catalog. These counts describe source, not an asserted capture of a running binary. [Exact core list](https://github.com/vercel-labs/agent-browser/blob/v0.37.0/cli/src/mcp.rs#L343-L373).

MCP failures use `isError`; structured results contain `response` with CLI `success`, `data`, and newer `code`. Text can be a snapshot, scalar or JSON, not one universal object. Dani shapes text and strips duplicate structured content, so any safety-relevant machine code must be interpreted first. The chosen binary's `tools/list` and open/click/error responses must be captured under an isolated HOME and compared with this integration. Protocol version 2024-11-05 remains supported in the candidate source. [0.37 output contract](https://github.com/vercel-labs/agent-browser/blob/v0.37.0/cli/src/mcp.rs#L3866-L3900), [0.41.2 MCP contract](https://github.com/vercel-labs/agent-browser/blob/v0.41.2/cli/src/mcp.rs).

## Interaction and retry strategy

- **Observe → identify → act → verify.** Use current model-visible refs; do not guess stale selectors or reuse refs across page/session replacement. Prefer scoped text/receipt checks to full-page rereads. Snapshot only when relevant state changed or the target is missing/stale; screenshot for visual ambiguity, not as proof of persisted effects.
- **Wait for the required state**, preferably selector/text/URL/application predicate. A completed `load` event is not a hydrated application; network-idle can never arrive on polling/SSE sites. The pinned core exposes only selector/text/load waits, so do not promise unsupported tools. [Official agent-browser waits](https://agent-browser.dev/commands#wait), [Playwright navigation/hydration](https://playwright.dev/docs/navigations).
- **Recover observations, not unknown mutations.** A missing current target or a failed side-effect-free observation can justify a bounded wait/fresh snapshot/reselection. A failed read endpoint can be retried when the operation is known read-only. Do not treat every HTTP GET as harmless navigation or every timeout as pre-dispatch failure.
- **Uncertain effects require reconciliation.** Click, fill, type, select, upload, eval, navigation and form submission can emit effects before an error returns. After transport loss, cancellation or native `outcome_unknown`, first prove the earlier operation ended, then inspect receipt/current provider state. Repeat only if non-application is established and permission still holds. Restart loses tabs/form input, not a committed external request.
- **Closed sessions are a state transition.** Reopen only the owned browser, warn that old refs/page input are lost, return to the authorized task page, and reconcile prior effects. Never attach to the person's browser, reset accounts, switch provider/model, or use shell/network escape routes to bypass a denial. Stop, human takeover and approval remain authoritative.

## Ownership and preview are separate from task completion

The current runtime generates a person-control refusal from its live ownership
gate, not a cached refusal field. A generic waiting spinner is not proof that
a person owns the browser; both engine paths can show it while attaching.
The source-backed legacy defect was a failed first takeover/restart reserving
ownership before its await, while `BrowserLive` started the hold clock only on
success. Parent-run regressions reproduced all three failed-reservation cases.
The repair starts the existing idle/disconnect policy at reservation, preserving
the non-controllable drain and every uncertain-input/Stop fence.

Separately, the legacy preview's ten-minute busy observation deadline classified
the result as terminal. A busy observation is recoverable: the client may
reconnect its view without taking a lease, resetting the browser, issuing model
prompts, or replaying input. A real human hold, an explicit denial, an asleep
browser and an uncertain accepted action must not be reclassified as permission
to act. See [live browser verification](../verification/browser-live.md) and
the `browser-live`, `browser-control` and `browser-stream-v1` regression suites.

The harness now has an internal, synchronous
`RuntimeRouter.agentAvailable(session)` admission query. It reads only
authoritative runtime/control state, including pending tab work and historical
shared-profile bindings; it does not launch, probe, read pages, claim ownership
or clear uncertainty. Resource leases and current turn permissions remain
separate required checks.

Adding that query exposed a native-backend defect: `BrowserService` swallowed
rejected backend-close promises, erased the handle and settled uncertainty.
The parent-run RED reproduced this for owned browsers, attached connections and
late-opening cleanup. Failed handles now remain retained for explicit cleanup;
no replacement browser is admitted, and only successful backend retirement or
its recorded exit can prove cleanup. Attached retirement remains connection-only,
not global cancellation of the person's browser or an external effect.
The availability/cleanup RED contained nine intended failures. These are
state-machine regressions; the native alternate backend's physical stop
qualification remains separate from the default agent-browser qualification.

## Official alternatives: mechanisms, not marketing

Browser Use's current ultrafast `bu.state()` reads fresh accessibility trees
using backend node IDs; its worker automatically observes after `bu` actions,
including failures, but not every arbitrary raw-CDP/Python mutation. Actions
use bounded settling (80 ms quiet, ordinarily an 800 ms cap; loading can extend
to 3 seconds). Replacing DOM nodes or navigating still invalidates targets;
settlement and a newly printed state are not a business-success assertion.
[State implementation](https://github.com/browser-use/browser-use/blob/dfb6a73d520809341c975c6a01c228327991e88b/browser_use/ax.py#L396-L503),
[post-action observation](https://github.com/browser-use/browser-use/blob/dfb6a73d520809341c975c6a01c228327991e88b/browser_use/repl/worker.py#L1166-L1172).

| Surface | What it actually contributes | Integration consequence |
| --- | --- | --- |
| **Browser Use 1.0.3** | Current 1.0 replaced the older DOM-index agent with model-written Python, persistent REPL and Browser Harness/CDP. `Agent` owns another model/decision loop. CLI/MCP lets an existing model drive Python without running that Agent. | Not a drop-in granular driver. Explicit local `Browser('chromium')` is needed because `Browser()` defaults to cloud. Local inference still requires a tool-capable endpoint. [Migration](https://github.com/browser-use/browser-use/blob/dfb6a73d520809341c975c6a01c228327991e88b/MIGRATING.md), [browsers](https://docs.browser-use.com/open-source/browsers.md), [MCP](https://docs.browser-use.com/open-source/mcp.md). |
| **Browser Use recovery** | Agent recovery returns failed cells for model decisions rather than replaying them; browser replacement warns of lost variables/page state. `is_done()` is completion status, while success is the agent's verdict. | It does not independently prove business success. Direct MCP runs Python in a server thread that cancellation cannot stop; code can continue after its lock is released. Do not import the Agent worker's cancellation guarantees into that MCP surface. [Recovery](https://github.com/browser-use/browser-use/blob/dfb6a73d520809341c975c6a01c228327991e88b/browser_use/repl/session.py#L504-L548), [MCP cancellation](https://github.com/browser-use/browser-use/blob/dfb6a73d520809341c975c6a01c228327991e88b/browser_use/mcp/cli_mcp.py#L580-L584), [output](https://docs.browser-use.com/open-source/output.md). |
| **Stagehand v4** | `observe`, `act`, `extract`; v4 removed the built-in agent orchestrator and no longer depends on Playwright. Recorded `Action` replay skips inference and snapshot/settle work. Optional self-heal retries execution failures, not proven effect-free attempts. | Local browser support is not local inference by itself. Natural-language operations need model configuration/callback; local Model Gateway is unsupported. Do not enable mutation healing as a generic retry policy. [Migration](https://docs.stagehand.dev/v4/migrations/v3), [act](https://docs.stagehand.dev/v4/basics/act), [models](https://docs.stagehand.dev/v4/configuration/models), [healing source](https://github.com/browserbase/stagehand/blob/9bb60e2f126e4c6eff7dc8bb0293785194d15057/packages/extension/services/actService.ts). |
| **Playwright** | Locators re-resolve on every action; actionability waits check visibility/stability/input state. Web-first assertions poll explicit postconditions. | No autonomous goal loop or closed-browser workflow reconstruction. A click may be dispatched before navigation fails. Avoid retrying mutation-plus-assertion callbacks wholesale. [Locators](https://playwright.dev/docs/locators), [actionability](https://playwright.dev/docs/actionability), [assertions](https://playwright.dev/docs/test-assertions), [browser close](https://playwright.dev/docs/api/class-browser#browser-close). |
| **Microsoft Playwright MCP** | Snapshot refs, deterministic action tools and subsequent-call backend recreation after disconnect. The external agent still owns task decisions. | A missing ref asks for a fresh snapshot; recreation does not recover task state. Current optional testing tools are not uniformly polling web-first assertions; generated assertion code in a response is not proof it executed. Pin a released implementation and qualify it rather than copying `@latest`. [Official repository](https://github.com/microsoft/playwright-mcp), [verification implementation](https://github.com/microsoft/playwright/blob/bac1f9f67e9cff2a8e7ecbac25d56ec3bb1d15c6/packages/playwright-core/src/tools/backend/verify.ts). |

No comparative same-task live-model measurements were collected by this research. Therefore no source-backed recommendation establishes that swapping to one of these engines would fix Dani's observed single-attempt stopping.

## Same-task live-model smoke design

Use one disposable loopback workboard and one fresh browser profile; the real selected Hermes executable/model/provider and native tool schemas must be recorded without secrets. Do not feed scripted actions or corrective user messages to the model.

Task: **Find Ada's draft, change its title to Release checklist, save, and report its receipt identifier and new revision.** The local target records actual requests and committed revisions outside the browser.

1. First read-only `GET /api/drafts` returns a real 503, with a visible failure and Reload drafts control. No write occurs. The same turn must observe the failure, recover with a bounded read/reload, and continue without an extra user prompt.
2. A successful reload rebuilds the DOM and changes target refs. The agent must use current evidence, open the right draft, fill and save once. Avoid leaking stable CSS selectors in the task prompt.
3. The receipt contains static, noninteractive text. Assert the requested draft/title/revision and exact receipt in both page evidence and target ledger; a model's final prose alone is insufficient.
4. A separate lost-acknowledgement variant commits Save but drops its acknowledgement. Assert one committed write, inspect receipt/ledger before retry, and no duplicate submission. The browser-native regression injects this below MCP by forwarding the real daemon command then dropping its response.
5. Separate negative runs deny Save, Stop during pending work, and close the owned browser before a read. Denial/Stop must not become a recovery retry; session recovery must discard old refs and preserve the task's permission scope.

Report separately: driver qualification, serving-path fixture behavior, real-model task success, and installed-app deployment. None implies the others.

## Qualification commands

Supply absolute reviewed engine/Chrome paths; fixtures create temporary homes and local pages. The default verification launcher installs a fake model CLI, so these commands prove real **browser** behavior, not real-model planning:

```sh
OMB_AGENT_BROWSER_PATH="$BROWSER_BINARY" AGENT_BROWSER_EXECUTABLE_PATH="$CHROME_BINARY" \
  pnpm exec vitest run scripts/testing/browser-evidence.e2e.test.ts \
  scripts/testing/browser-safety.e2e.test.ts

pnpm exec vitest run server/browser-runtime.test.ts server/browser-engine.test.ts \
  server/browser-tool-shape.test.ts server/browser-steps.test.ts \
  server/browser-processes.test.ts scripts/prepare-browser.test.mjs

pnpm exec vitest run server/browser-live.test.ts src/lib/browser-stream-v1.test.ts \
  src/lib/browser-control.test.ts

OMB_VERIFY_BROWSER_BINARY="$BROWSER_BINARY" OMB_VERIFY_BROWSER_CHROME="$CHROME_BINARY" \
  node --experimental-strip-types scripts/verify-browser-live.ts

node scripts/smoke-browser-bundle.mjs --resources "$PACKAGED_RESOURCES"
```

Run packaged smoke natively for each supported OS/architecture; `--check-only` is structure-only. Windows hard-stop proof remains a separately documented limit until native evidence establishes it. Do not publish, install over the live app, or claim automatic updates from source changes alone.
