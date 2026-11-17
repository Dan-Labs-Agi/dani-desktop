# Browser-use baseline

Status: approval packet; product code unchanged. Observed 2026-11-10 UTC for the owner's 2026-11-11 brief.

## Identity and isolation

- Repository: `Dan-Labs-Agi/dani-desktop`.
- `git fetch origin main` returned **`c077c7940be477e50857b106f7e1cf4202babd81`**, matching the reported short SHA. B1–B4 used that exact source before these documentation files existed. B5 is a separately attributed peer run of the same source.
- Isolated checkout: `/tmp/dani-browser-use-spec-20261111`; branch: `docs/browser-use-evidence-20261111`. The original app-fix checkout and PR #27 are not the baseline and were not reset or modified.
- Environment output: Node `v26.8.1`, pnpm `10.33.0`, Vitest `4.1.11`, `Darwin x86_64`. CI below used Node `v24.22.2`; local results are not a reproduction of every hosted runner.
- Local tests use the repository's temporary-home setup. B2/B3 used owned fresh profiles and synthetic loopback pages, not the user's browser, accounts or app data. B1 also includes the existing auto-discovered native hostile-page suite and its public `example.com` connectivity check; it is not wholly offline. No live model calls, paid keys or personal usage traces were read.
- Parallel harness-research session owns only `specs/harness-experiment/` in a different checkout/branch. Ownership and receipts were exchanged through `/tmp/dani-omp-coordination-20261111/`. Neither session may edit the other's files.

Evidence vocabulary throughout this packet: **[V]** means the stated source was inspected or the stated command was executed; the text distinguishes those cases. **[CTO2]** is an unconfirmed supplied report. **[UNVERIFIED]** means not established; it never means likely to pass. A historical measurement quoted from a document is not a new measurement.

## Hosted CI and Release: failures already on main

Read-only commands, not workflow reruns:

```sh
gh run view 42674832142 --repo Dan-Labs-Agi/dani-desktop --json databaseId,name,event,headSha,headBranch,status,conclusion,url,jobs
gh run view 42674832142 --repo Dan-Labs-Agi/dani-desktop --log-failed
gh run view 42674832793 --repo Dan-Labs-Agi/dani-desktop --json databaseId,name,event,headSha,headBranch,status,conclusion,url,jobs
gh run view 42674832793 --repo Dan-Labs-Agi/dani-desktop --log-failed
```

Both runs report `headSha=c077c7940be477e50857b106f7e1cf4202babd81`, `headBranch=main`, `event=push`, `conclusion=failure`.

| Run / job | Observed baseline | Cause supported by logs/source | After this docs-only proposal |
|---|---|---|---|
| [CI: control-plane](https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/42674832142/job/129353276388) | 19 failed, 124 passed; 2 files failed, 4 passed; `pnpm control-plane:test` exits 1 | Account/suffix fixture disagreement; see below. One test also times out at 5 s. | Unchanged; no fix or rerun claimed. |
| [CI: Ubuntu offline package](https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/42674832142/job/129353277195) | `Package from the verified offline CUA stage` fails | esbuild cannot resolve `server/danibot.ts`; it fails before a usable package/smoke result. | Unchanged; not evidence that adding a browser dependency is safe. |
| [CI: iOS](https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/42674832142/job/129353555394) | Simulator build exits 65 | Asset catalog reports AppIcon has no applicable content. | Unchanged; no iOS build rerun. |
| [CI: desktop matrix](https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/42674832142) | Windows, macOS and Ubuntu test jobs cancelled | Cancellation is not a passing test result; a causal cancellation diagnosis was not established. | No success claim. |
| [Release: Linux](https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/42674832793/job/129353516836) | Build Linux packages fails | Missing `server/danibot.ts`. | Unchanged. |
| [Release: both Macs](https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/42674832793/job/129353516860) | Build macOS packages fails | Missing `server/danibot.ts`. | Unchanged. |
| [Release: Windows](https://github.com/Dan-Labs-Agi/dani-desktop/actions/runs/42674832793/job/129353516901) | Build Windows packages fails | Missing `server/danibot.ts`. | Unchanged. |
| Release draft assembly | Skipped | Packaging dependencies failed. | No release created by this work. |

CI optional-job detection, spec traceability, and Android jobs report success. Release's SHA-pinning job reports success. Those do not make either entire workflow successful.

Exact failure excerpts:

```text
Test Files  2 failed | 4 passed (6)
Tests       19 failed | 124 passed (143)
error: Could not resolve ".../server/danibot.ts"
Assets.xcassets: error: The stickers icon set, app icon set, or icon stack named "AppIcon" did not have any applicable content.
Process completed with exit code 65.
```

[V, source] `scripts/bundle-server.mjs:36,67` names the absent entrypoint. Control-plane `test/managed-endpoints.test.ts:2232,2272-2277,2393` supplies/asserts mixed-case `Danibot.si`, while `src/config.ts:168-169,240-245` rejects non-lowercase suffixes and drops that account. `src/endpoint-accounts.ts:60-62` is case-sensitive; `test/endpoint-accounts.test.ts:290` supplies a mixed-case hostname against the lowercase account. This explains concrete account-fixture disagreement; it is not a verified repair of all 19 failures.

[V, local file inspection] The iOS icon file exists, but these commands returned:

```sh
file ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png
# ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png: data
sips -g pixelWidth -g pixelHeight ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png
# pixelWidth: <nil>
# pixelHeight: <nil>
```

## Local baseline commands and actual output

Commands run from the isolated checkout. No CI-only file exclusion, retry flag, edited expectation or failure suppression was added.

### B1 — browser, browser host and harness proxy

```sh
env -u DANI_DATA_DIR -u OMB_DATA_DIR -u OMB_VITEST_E2E -u CI \
  pnpm exec vitest run server/browser server/host/browser.test.ts server/harness-mcp-proxy.test.ts \
  --reporter=default --reporter=json --outputFile.json=/tmp/dani-browser-use-baseline-20261111.json
```

```text
FAIL server/harness-mcp-proxy.test.ts:120
Expected: /^DaniBot is restarting, so this browser call did not reach it and did not run\. Wait a few seconds/
Received: "Dani Bot is restarting, so this browser call did not reach it and did not run. Wait a few seconds, then make it again. ..."
Test Files  1 failed | 52 passed | 7 skipped (60)
Tests       1 failed | 950 passed | 105 skipped (1056)
Duration    234.78s
Exit        1
```

The assertion compares incidental wording. This is a real baseline failure, not evidence that capability enforcement failed. It was left unchanged, not re-pinned or rerun until green.

| B1 subset | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Browser-prefix files | 889 | 0 | 105 |
| `server/host/browser.test.ts` | 45 | 0 | 0 |
| `server/harness-mcp-proxy.test.ts` | 16 | 1 | 0 |

The 105 skips comprise 101 assertions across seven opt-in real-Chrome suites, one hostile-page CI prerequisite, and three platform-specific assertions. The entire unrelated host directory was not selected by B1. Existing Vitest runner deprecation warnings remained visible.

The hostile-page suite's actual assertions ran in B1 on auto-discovered Chrome; only its CI-prerequisite assertion was skipped. Its helper is less strictly home-isolated than B2, although browser profile state is temporary. The test's public-connectivity branch is source-defined at `server/browser/egress/hostile-pages.e2e.test.ts:297-311`; no user website/account was used.

### B2 — existing native agent-browser smoke

```sh
node scripts/smoke-browser-bundle.mjs \
  --resources '/Applications/Dani Bot.app/Contents/Resources' --target darwin-x64
```

```text
"ok": true
"target": "darwin-x64"
"engineVersion": "agent-browser 0.37.0"
"chromeVersion": "Google Chrome for Testing 153.0.8010.47"
"cleanup": "owned browsers, local HTTP server, and isolated home removed"
Exit 0; wall time 5.16s
```

[V, executed] One synthetic native smoke exercised cold MCP navigation, title, fill/click and DOM result, relay reads, refs, screenshot, close/reopen, and two-profile cookie/localStorage isolation. The returned PNG was 1280×720. Runtime binaries were borrowed **read-only from the installed local.3 app** and matched main's pinned versions; the smoke runner/imported code was exact main. This is not a successful build of main's broken package, a live website task, or a performance bake-off.

### B3 — existing native Dani Chrome/CDP checklist

```sh
env -u DANI_DATA_DIR -u OMB_DATA_DIR -u OMB_VITEST_E2E -u CI OMB_CDP_E2E=1 \
  pnpm exec vitest run server/browser/checklist.e2e.test.ts \
  --reporter=default --reporter=json --outputFile.json=/tmp/dani-browser-use-cdp-native-20261111.json
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --version
```

```text
Test Files  1 passed (1)
Tests       16 passed (16)
Duration    72.33s
Exit        0
Google Chrome 148.0.7778.97
```

[V, executed] Synthetic loopback pages and fresh owned profiles: navigation/refs, fill/click, persisted synthetic sign-in, temporary/shared profile deletion, uploads/downloads, dialogs/popups, HTTP sign-in, human hold blocking every bot call and clean hand-back, restart/idle close, and an egress refusal. These 16 tests overlap B1's skipped checklist; they are not 16 additional distinct baseline regressions. No blanket cancellation/write-approval guarantee follows. Different browser binaries and workloads make B2/B3 durations incomparable.

### B4 — offline evals

```sh
env -u DANI_DATA_DIR -u OMB_DATA_DIR -u OMB_EVAL_LIVE -u CI \
  pnpm exec vitest run --config evals/vitest.config.ts \
  --reporter=default --reporter=json --outputFile.json=/tmp/dani-browser-use-evals-baseline-20261111.json
```

```text
Test Files  5 failed | 8 passed (13)
Tests       7 failed | 62 passed (69)
Duration    169.07s
Exit        1
live tier skipped: offline by default; set OMB_EVAL_LIVE=1 ... to run real-model smoke evals
```

Zero test assertions skipped. The passing live-gate unit assertion checks that real-model execution remains off; it is not a real-model pass.

| Failing assertion | Observed failure |
|---|---|
| `dispatch-supersede` | `mutating commands require an explicit Dani Bot instance` |
| `routine-deferral` | Same explicit-instance refusal |
| `skill-assignment-visibility` | Same explicit-instance refusal |
| Golden handoff replay | Same explicit-instance refusal |
| Skill-bench alpha report | Six arm runs return the same explicit-instance refusal |
| Judge manifest verification | `open-ended-v1.md does not match its manifest checksum` |
| Local-VM skill installation | `result.pass` is false; no underlying cause established by this assertion alone |

[V, source] `evals/runners/coordination-world.ts:32` supplies `DaniBot_URL`, whereas the control CLI documents `DANIBOT_URL` or explicit `--url` (`scripts/control-omb.ts:64`). Do not bypass the safe explicit-instance requirement. No eval code, manifest checksum or golden output was changed. These are harness/evaluation baseline failures, not proof that another browser SDK improves tasks.

### B5 — peer's independently executed full-area baseline

The harness session had already started its broader run before receiving the test-ownership note. It used a separate checkout and temporary fixtures. This session inspected its command metadata and JSON report **read-only**; these are peer-executed receipts, not another command executed here.

```sh
pnpm exec vitest run server/browser server/host server/harness-mcp-proxy.test.ts evals \
  --reporter=default --reporter=json \
  --outputFile.json=/Users/dan/Desktop/x/daxxxx/dani-harness-evidence-20261111-7rwkiq1k/baseline-vitest.json
```

```text
baselineSha c077c7940be477e50857b106f7e1cf4202babd81
Test Files  14 failed | 118 passed | 7 skipped (139)
Tests       38 failed | 1722 passed | 104 skipped (1864)
Duration    727.99s
Exit        1
```

| B5 subset | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Browser-prefix | 890 | 0 | 104 |
| `server/host/` | 719 | 21 | 0 |
| Other `server/host` prefix matches, including hosted tests | 35 | 9 | 0 |
| Harness proxy | 16 | 1 | 0 |
| Evals | 62 | 7 | 0 |

The browser-count difference from B1 is exactly the CI-only Chrome prerequisite: skipped in B1's sanitized environment, passed in B5. These overlapping invocations must not be added together. B5 did not explicitly unset CI, unlike B1; no identical-environment claim is made.

Additional host failures occur in chief-notices-retry (4), devs-reports (4), loop-guard (8), MCP requests (2), question-routing (1), and secret-cards (2). Several name/wording assertions disagree; array/behavior assertions also fail, so they are not all dismissed as cosmetic. Hosted-access (8) and hosted-models-api (1) report missing expected enterprise startup text/readiness and503 responses instead of expected200/302. Their underlying causes were not independently diagnosed here. All remain baseline failures; no wording repair, provider-policy relaxation or hidden skip is part of this packet.

## Re-verified architecture and limits

[V, source] All CONTEXT paths were inspected. `server/browser/config.ts:19-39` defaults to agent-browser; `server/browser/engines.ts` routes the alternate CDP engine. `server/host/browser.ts:332-366` mints the browser capability and mounts `server/harness-mcp-proxy.ts`; `server/index.ts:13120-13162,13269-13303` rechecks the active generation, permissions and current browser before dispatch and before returning results.

- Capability **authorization** is turn-scoped; bearer bytes can be reused for unchanged grants (`server/index.ts:1642-1855`). Do not promise fresh token bytes every turn.
- Whole-turn resource claims and call lanes prevent concurrent unauthorized use. Profiles intentionally support own, named shared and temporary identities, with Team audience suffixes (`server/host/browser.ts:240-271`, `server/browser/audience.ts`). Shared profiles are not independent private sessions.
- `service.ts`, `dispatch.ts`, `control.ts` and `session-control.ts` own CDP profile/lane/control/redaction behavior. `backends.ts` supplies connections, not a public arbitrary SDK capability.
- Owned browsers use the common destination-checking SOCKS egress gate. My Chrome intentionally does not; current policy is not a universal domain-only allowlist or HTTP write authorizer (`server/host/browser.ts:167-170`, `server/browser/egress/policy.ts`).
- **Universal per-write human approval is not currently enforced at the browser dispatch boundary.** Provider approval modes differ. A new SDK does not create this guarantee (`server/index.ts:13269-13303`, `server/drivers/chat-tool-approval.ts`, `server/drivers/claude.ts:1093-1121`, `server/drivers/codex.ts:707-726`).
- Cancellation/revocation blocks future dispatch/result delivery, not necessarily an already accepted action. Configured call/proxy budgets are 120/130 seconds; lane wait is 30 seconds. These are configuration, not measured cancellation latency. CDP takeover grants after its 15-second drain with uncertainty if work remains; the default runtime's uncertain-work behavior differs.
- Text scrubbing and sensitive-field protections exist; arbitrary private text/pixels are not universally detected. Images pass through generic result scrubbing. CDP recorded-step parity and saved-login screenshot protection remain unverified (`server/browser-tool-shape.ts:162-170`, `server/browser/engines.ts:219-246`, `server/browser/service.ts:580-613`).
- Physical computer use remains separate (`electron/cua.mjs`, separate internal routes/tool surfaces). No physical-use system was tested or changed by this packet.

## Prior decision, why-now evidence and traces

The entire 349-line [September browser plan](../../docs/plans/browser-engine.md) was read. Its explicit Stagehand/browser-use rejection is a second model loop (line 347). Headless/server operation, cross-platform contract, profile ownership and human control remain requirements; September's then-current lack of a Windows/server browser is historical, not a present-state claim.

[V, historical source] Lines 307–332 record agent-browser 0.37.0 with macOS headless-shell 153 stalling about 35 seconds after about 650 uncaught errors. The committed fixture contains a 1,100-error flood and skips that assertion for headless-shell (`scripts/testing/browser-evidence.e2e.test.ts:35-42,158-169`). This is a concrete reason to investigate observability under load, **not a newly reproduced failure or evidence that Stagehand/Pomerado fixes it**.

No committed real-user browser-task failure trace or matched browser-engine benchmark was found in the inspected eval reports, golden sets, skill bench, browser plans or verification recipes. Personal usage data was not searched. The golden fixture and skill bench concern coordination, not browsing.

Trace locations/formats verified from source, without reading user data:

| Evidence | Writer and format |
|---|---|
| Usage spans | `server/usage-trace/spans.ts`: `DATA_DIR/usage/spans/YYYY-MM-DD.jsonl`; `StepSpan` / `ToolSpan` keyed by turn/thread; timings, tokens, status, clipped detail; buffered append; 0700/0600; 90-day retention. |
| Browser timing receipts | `server/usage-trace/recorder.ts:333-410`; server MCP timing can replace matching provider timing. |
| Trace visibility/redaction | `server/usage-trace/detail.ts`, `shared/usage-trace.ts`, `server/routes/usage.ts`; partial/unavailable usage is not zero; access pruned to readable threads. |
| Browser steps | `server/browser-evidence.ts`, `server/browser-steps.ts`: versioned JSONL plus JPEGs under `DATA_DIR/evidence/<thread>/<generation>/`; 30-day retention; not proven equivalent on both engines. |
| Evals | `evals/README.md`, runners/scorers, golden redactor/baseline, skill-bench fixtures; scripted synthetic engines, not model-quality measurements. Runtime reports/live baselines are ignored. |

## Comparison and platform evidence boundary

Matched same-task, same-model comparison runs: **0 for each of agent-browser, Dani Chrome/CDP, Stagehand and Pomerado**. No task-success rate, step reduction, token saving or vendor advantage has been measured. Do not substitute the functional commands above for that comparison.

| Backend | Mac Intel | Mac Apple Silicon | Windows x64 | Linux x64 |
|---|---|---|---|---|
| agent-browser | B2 native synthetic smoke executed | Not tested | Not tested | Not tested |
| Dani Chrome/CDP | B3 native synthetic checklist executed | Not tested | Not tested | Not tested |
| Stagehand | Not tested | Not tested | Not tested | Not tested |
| Pomerado | Not tested | Not tested | Not tested; local source explicitly rejects Windows | Not tested |

After column means **unchanged source**, not an unperformed post-change test run. This packet adds documentation only; baseline failures remain open. Any later implementation must compare exact test identities and skipped reasons against B1/B4, not merely preserve a total count.
