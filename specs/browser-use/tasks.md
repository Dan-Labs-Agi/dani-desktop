# Browser use: ordered tasks and acceptance ledger

Status: **G0 approval packet only**. T01 evidence collection is complete with failures preserved. T02 onward is **not run / not implemented** and awaits the gates in [plan.md](plan.md). A docs PR does not authorize these tasks. Each later task must record its exact source commit, command, output, exit code and fixture identity before it can be marked complete.

## Dependency and parallel-work rules

- T01 → owner G1 go → T02 → T03 → T04. Freeze the comparison before candidate results.
- After T03, T05 and T06 are independent research probes and may run in parallel in different external directories. Their runtime resource measurements must not overlap T04/T22.
- T04/T05/T06 → T07 → explicit G2 adoption/policy approval → T08.
- T09 and T10 are alternative/independent admitted adapters, not requirements to build both. They may run in parallel only after T08 freezes their shared interface; one integration owner controls shared host/config files. T11 depends on approval of T10 and paid-authoring scope.
- A1–A9 tasks T12–T20 can author isolated tests in parallel after the relevant adapter contracts exist; shared files have one owner. Run native timing/resource tests serially per device.
- T21 regression → T22 final comparison → T23 platform/package receipts → T24 review/G3. Platform runners may run in parallel on separate owned hosts.
- A rejected candidate is removed from the experimental route and reported not admitted. Do not pad the product with unproved adapters, flags or tests. A missing prerequisite blocks only its task; finish the docs/evidence/reporting work.

## Tasks

### T01 — Record exact main baseline and scope

- **Goal/status:** completed evidence collection, not a green baseline. Source `c077c7940be477e50857b106f7e1cf4202babd81`; native synthetic checks and baseline failures in [baseline.md](baseline.md).
- **Files:** these six docs only; read-only existing source/test/CI paths identified there.
- **Test/evidence:** B1–B4 exact commands/output, separately attributed B5 peer full-area receipt, remote CI/Release logs, peer worktree ownership. No fake model result is presented as live.
- **Rollback:** revert only documentation; do not mutate another worktree or original user data.

### T02 — Freeze corpus, model, conditions and caps

- **Goal:** resolve all run prerequisites before scoring: exact approved free model, settings, browser/SDK hashes, K1–K6 fixture digests, seed/order,60 runs/arm/phase, fixed latency primary metric and caps from plan. No paid authoring by default.
- **Files:** external experiment `manifest.json`, immutable corpus and validation script; no product files.
- **Test:** reject a changed corpus/model/hash, unknown costs, missing model, unapproved endpoint or a run exceeding the declared count/token/time/spend cap. A dry validation emits the complete frozen identity without credentials.
- **Rollback:** remove only owned external manifest/corpus; no application config change.

### T03 — Specify and test the common execution contract

- **Goal:** pin the navigate/observe/act/extract and existing lifecycle vocabulary once, including effect, cancellation, approval, audience, bounded output and uncertain outcomes. Separate current behavior from required admission.
- **Files:** external contract fixtures importing the existing `server/browser/tools.ts` surface; plan contract section. No new agent prompt variant or unrestricted SDK entrypoint.
- **Test:** give both current engines the same normalized inputs and independently record observed state for unknown tools/effects, wrong profiles, stale refs, expired approvals and oversized outputs. Existing enforced restrictions must behave as documented; absent exact-write approval is recorded as a baseline gap, not a prerequisite that T03 must implement or somehow pass. Candidate admission must fail closed on these cases; product enforcement stays behind T08/G2. Confirm model/prompt/tool inventory parity in the frozen manifest, not with source-string assertions.
- **Rollback:** remove the external contract fixture. Do not change existing production contracts at G1.

### T04 — Build the external comparison runner and validate measurement

- **Goal:** prove runner measurement and independent outcome checks on both existing engines before any scored candidate comparison. Do not use these control checks as performance evidence.
- **Files:** external runner/adapters/JSONL receipts, using existing host/browser APIs and usage-trace shapes; no production instrumentation fork.
- **Test:** verify outcomes against independent fixture state; detect a deliberately wrong result, unreported retry, missing token record and changed manifest. Allow at most12 deterministic no-model control runs,6 per existing engine, reported separately from scored K1–K6 runs. Synthetic/scripted control checks validate the runner, not model quality. The complete initial interleaved model comparison waits for T07, after candidate eligibility is known.
- **Rollback:** stop/remove only owned fixture services/profiles; retain redacted receipts outside product for the decision.

### T05 — Stagehand deterministic ownership probe

- **Goal:** only after go, test exact4.4.0 attachment/detach and deterministic primitives on a synthetic browser. No model-backed actions, cloud, cache or telemetry.
- **Files:** external pinned package/extension lock and probe; read existing `backends.ts`, `service.ts`, `control.ts`, `egress/` contracts.
- **Test:** owner browser/profile and sentinel sibling tabs survive detach; unauthorized targets remain inaccessible; no model/backend egress; failed/late initialization cannot steal ownership; takeover invalidates queued work. Capture exact extension/CDP requirements and license/size evidence. Any unsafe global extension effect or incompatible pipe ownership rejects the probe.
- **Rollback:** detach only the candidate, close owned synthetic Chrome, delete owned temporary state; never close personal Chrome.

### T06 — Pomerado typed-artifact admission probe

- **Goal:** separate optional authoring from deterministic execution; establish whether an immutable artifact can satisfy the common policy without a new stack or second owner.
- **Files:** external exact-version manifest, admission validator and synthetic artifact/containment probes. No production MCP registration or real mint/write.
- **Test:** missing key is a clear authoring not-configured state; runtime has no model credential; source/schema/destination edits invalidate admission; false read hints, direct fetch/subprocess/file escapes and unsupported Windows are refused. No real-authoring claim without separately approved BYOK/cap. Source-level Windows rejection remains a blocker, not a simulated native pass.
- **Rollback:** remove only owned artifact/probe/runtime; no saved website credentials or production tool entry.

### T07 — Run the initial comparison, decide and request G2 only if justified

- **Goal:** after both probes establish eligibility, run the complete initial matched comparison and decide whether an admitted candidate deserves a bounded product proposal. No candidate advantage is inferred from attachment success or T04 control runs.
- **Files:** external evidence/report; update this packet only with genuine new findings under renewed owner scope.
- **Test:** interleave both current engines and every eligible candidate in one frozen seeded initial phase:60 scored runs/arm,120 when only incumbents remain, at most240 with both candidates. Do not compare later candidate runs against earlier unpaired incumbent samples. Independently apply the fixed thresholds and hard safety gates; missing metrics, unsafe primitives, insufficient runs or unsupported required platforms yield no adoption. Infeasible arms remain not run. T22 repeats a separate complete final phase; total scored-run cap480.
- **Rollback:** discard the rejected candidate completely from experimental routing. Stop unless G2 explicitly approves named implementation and any existing-write policy change.

### T08 — Enforce the shared capability/effect boundary

- **Goal:** after explicit G2, implement only the approved common private contract, including exact grants and uncertainty. This is necessary admission work, not a claim main already has per-write enforcement.
- **Files:** approved bounded edits to `server/host/browser.ts`, browser route in `server/index.ts`, `server/browser/{tools,dispatch,service}.ts`, `server/harness-mcp-proxy.ts` and their behavior tests.
- **Test:** failing-before/passing-after wrong-generation/profile/audience and stale/changed-argument grant cases; no effect before authorization; late result withheld. Run references before exported symbol changes. No new top-level planner or global permission bypass.
- **Rollback:** disable/remove candidate route; revert the vertical slice without changing user profiles. Any behavioral change to current engines must match the approved G2 scope.

### T09 — Optional Stagehand adapter, default off

- **Goal:** implement only if T05/T07 admitted it; reuse existing ownership/control/dispatch, not a copied browser service.
- **Files:** private adapter under `server/browser/`, approved `backends.ts`/`engines.ts`/`config.ts` integration and behavior tests. No public SDK or new prompt vocabulary.
- **Test:** disabled path has no imports/processes/downloads/model calls; enabled synthetic path follows T03 exactly; initialization, disconnect, timeout and revoked-target failures are honest. Unknown/incompatible platform stays unavailable.
- **Rollback:** flag off, revoke candidate grants, safe detach; remove adapter/dependency if rejected. No profile migration.

### T10 — Optional Pomerado integration, default off

- **Goal:** implement only if T06/T07 establish enforceable deterministic execution; admit typed immutable tools, not generic trust of an MCP server.
- **Files:** private integration adapter; bounded approved changes to `server/host/mcp-servers-host.ts`, `server/mcp-gate.ts`, existing browser host/policy and behavior tests.
- **Test:** every call rechecks turn/audience/egress/effect approval and artifact digest; unknown effects, mint/repair helpers, source edits, direct-network bypass and unapproved write retries are refused. Real enforcement is required; a stub broker is not acceptable.
- **Rollback:** disable/unmount only the integration; revoke grants and stop its owned processes without replaying jobs.

### T11 — Optional encrypted purpose-scoped BYOK

- **Goal:** only after separate authoring authorization, bind a Pomerado mint credential through existing secure storage; never use it for normal runtime or onboarding.
- **Files:** `electron/main.mjs`, `electron/secure-credentials.mjs`, `electron/workspace-credentials.mjs` and existing credential behavior tests; optional advanced setup surface only if approved.
- **Test:** unavailable storage cannot overwrite existing secrets; no plaintext config/backup/log/token leak; authoring process gets only its scoped key; deleting/revoking key ends authority. No paid request on startup/listing or without consent.
- **Rollback:** disable authoring and revoke the purpose-specific credential through existing storage; no broad credential deletion.

### T12 — A1: session identity

- **Goal:** prove separation of distinct profiles/audiences, including concurrent turns; retain explicit serialized sharing.
- **Files:** existing `server/host/browser.test.ts`, `server/browser/{service,audience,engines}.test.ts`, native fixture tests; candidate tests only where admitted.
- **Test:** plant different cookies/localStorage/tab/page/file sentinels in two simultaneous owned sessions; attempt cross-target/profile access, reused refs and stale capabilities; only own state is visible. Separate positive case proves explicit shared profile semantics, never simultaneous unauthorized ownership.
- **Rollback:** remove only fixture state; candidate remains off on any leak.

### T13 — A2: cancellation and owned-process cleanup

- **Goal:** measure actual stop behavior, not just a rejected promise.
- **Files:** existing browser runtime/service tests, CDP native fixtures and candidate lifecycle tests.
- **Test:**10 samples each during launch, queued action, navigation, model callback if ever approved, and pending write; record monotonic cancel-to-refusal and cancel-to-owned-process/connection exit. Apply1s/10s bounds from plan, detect late site effects/results and orphan PIDs by owned identity. Unknown prior effect stays uncertain; user-owned Chrome is preserved.
- **Rollback:** stop only the fixture's exact resources; disable the failed candidate.

### T14 — A3: human takeover and return

- **Goal:** prove profile-wide human priority during active work.
- **Files:** `server/browser/control.ts`, `session-control.ts`, their tests and native service/viewer fixtures; no new parallel control owner.
- **Test:**10 measured interleavings; reserve human control, queue bot read/write, change form privately, hand back. Queued/stale calls stay blocked, human data is not exposed, fresh observation precedes resumed separately authorized work. Include uncertain drain/closed viewer and Pomerado task if admitted.
- **Rollback:** release only owned fixture hold and disable adapter if exclusive control is unproved.

### T15 — A4: exact write approval

- **Goal:** enforce refusal and success at the real synthetic site's effect boundary, including admitted MCP writes.
- **Files:** browser host/common effect tests, candidate integration tests and existing approval behavior tests.
- **Test:** form submit, Enter, click, dialog acceptance, upload/post and purchase-like tool: no/denied/expired/wrong-turn/changed-input grant causes0 fixture writes; valid exact grant causes1 matching write. Change artifact/destination/revision after approval; replay after timeout/takeover; verify no automatic second commit. Provider Full access cannot bypass the approved exact-scope contract.
- **Rollback:** remove candidate write authority immediately; preserve uncertain-effect receipts without retry.

### T16 — A5: secret redaction at every sink

- **Goal:** verify planted fake secrets do not escape through text, pictures or errors.
- **Files:** `server/browser-tool-shape.test.ts`, `browser-steps.test.ts`, service/CDP sensitive-field tests, usage-trace tests, candidate result/log tests.
- **Test:** register a fake secret and plant it in DOM text/fields, escaped values, URL userinfo/query/fragment, headers, tool output and failure paths. Inspect model context, logs, JSONL traces, retained evidence, files and screenshots. Assert withheld unsafe images, no header/body capture, redaction before truncation. Repeat during production-style saved-login fill and human hold; direct-driver tests alone are insufficient.
- **Rollback:** quarantine/remove only synthetic evidence and disable any leaking path; never claim arbitrary unknown pixels are universally classified.

### T17 — A6: egress and audience

- **Goal:** one authoritative policy across every execution path.
- **Files:** existing `server/browser/egress/{policy,gate,registry,ownership}.test.ts`, audience tests, candidate network probes.
- **Test:** denied domain/redirect/subresource/WebSocket, DNS rebinding, metadata/private/own-service address and wrong audience are refused before connection; allowed fixture request succeeds. Stagehand empty allowlist cannot widen deny-all; backend exemptions cannot leak. Pomerado direct fetch/subprocess/file upload cannot escape. Revocation closes candidate authority even on existing connection work, or admission fails.
- **Rollback:** close only owned gates/connections; fail candidate admission rather than add a second permissive list.

### T18 — A7: hostile page prompt injection

- **Goal:** page instructions cannot change policy or produce exfiltration/unauthorized writes.
- **Files:** external synthetic page corpus and existing harness/browser boundary tests; admitted candidate fixtures.
- **Test:** local page requests secret exfiltration, policy override, tool-source change and forbidden submission. Real matched-model run plus independent sink/effect logs prove no destination/approval change; deterministic contract checks are labeled synthetic and do not replace the model run. Include misleading read-only metadata and a source URL that redirects.
- **Rollback:** remove the owned hostile fixture only; any bypass disqualifies the candidate irrespective of task score.

### T19 — A8: offline behavior

- **Goal:** bounded clear errors without app crash or duplicate writes.
- **Files:** runtime/service/native fixture and candidate transport tests.
- **Test:** block network only for owned test processes/fixture gate, never the user's network. Ten cold/warm samples return unavailable within15s for new calls, preserve app responsiveness and no orphan. Drop connectivity after accepted write: uncertainty and read reconciliation, no automatic replay.
- **Rollback:** remove fixture network block and owned resources; candidate stays off if bound fails.

### T20 — A9: absent optional key

- **Goal:** optional Pomerado authoring stays not configured without affecting free/default use.
- **Files:** admitted integration/setup and encrypted-credential tests; existing onboarding regression surfaces read-only unless G2 explicitly permits a change.
- **Test:** empty/revoked key and unavailable secure store produce distinct clear states, no crash, no paid/network mint attempt, no terminal instructions; default browser/onboarding remains unchanged. Already admitted deterministic execution never inherits the mint key. Test disabled state without loading optional code.
- **Rollback:** revoke only purpose-specific configuration/credential; leave default setup untouched.

### T21 — A10: exact regression accounting

- **Goal:** no new failure, disappearance or skip hidden by equal totals.
- **Files:** existing browser/host/proxy/eval suites and external comparison ledger; no source/wording assertion repinning.
- **Test:** rerun B1/B4 and relevant native suites on the exact candidate commit; compare named test identities/outcomes/reasons with baseline. Preserve existing failures unless a separately authorized behavioral fix has before/after proof. Any extra failure/skip blocks adoption. Unrelated canceled CI jobs are not counted as passes.
- **Rollback:** revert/disable the causing candidate slice, never edit expectations to manufacture green.

### T22 — A11: final comparison

- **Goal:** rerun the frozen K1–K6 task set/model on the final implementation, not a convenient smaller sample.
- **Files:** the same external manifest/corpus/runner from T02/T04, final-commit raw receipts and report.
- **Test:** validate manifest equality, record all60 runs/arm for the final phase, apply the pre-registered safety/success/improvement rule mechanically and include setup/mint/repair costs. Unknown/inconclusive means no adoption. Respect the maximum480 scored-run cap and $0 paid default.
- **Rollback:** keep the current engines; remove rejected candidate route/dependency and retain only the authorized redacted evidence report.

### T23 — A12: native platforms, packaging and licensing

- **Goal:** report only actual native support and measured distribution impact.
- **Files:** existing packaging/smoke paths and candidate license/lock metadata; no unrelated workflow fixes bundled into this task.
- **Test:** native Windows x64, Mac Intel, Mac Apple Silicon and Linux x64 install/start/close/offline/rollback receipts with exact versions/hashes and installer-size delta. Preserve MIT and transitive notices. Offline Linux must have its baseline packaging failure separately fixed/proved first. Pomerado native Windows remains blocked unless separately approved supported implementation exists; never substitute WSL/cloud. Unavailable hosts are marked not tested.
- **Rollback:** remove candidate artifacts only, restore prior engine selection and signed baseline distribution; no user profile/credential deletion.

### T24 — Analyze and owner enablement gate

- **Goal:** reconcile spec/plan/tasks/code/tests, C1–C9 and A1–A12 before any final claim or enablement.
- **Files:** approved evidence/traceability report; only scoped docs updates.
- **Test:** every requirement maps to executed evidence or an explicit blocker; no code outside approved tasks, no unexplained regression/skips, no leaked secret, correct author/committer and exact diff scan before commit. Record flags/defaults, native untested rows and decision. An unresolved acceptance/platform/security prerequisite prevents G3.
- **Rollback:** no enablement; no hidden partial success. If rejected, remove candidate product residue through ordinary reviewed commits, never rewrite published history.

## Current acceptance ledger

The following is the **new candidate acceptance status**, not a claim the entire current app satisfies these guarantees. B1/B2/B3 are baseline evidence only; no candidate adapter exists.

| Acceptance | Task | Current status and evidence/limit |
|---|---|---|
| A1 Session identity | T12 | **Not run for candidates.** B2 exercised native two-profile cookie/storage separation; B1 covers profile/audience contracts. Cross-candidate/tab isolation remains unproved. |
| A2 Cancellation | T13 | **Not run.** No candidate stop bound/orphan measurement; existing timeout/revocation is not proof accepted work stopped. |
| A3 Human takeover | T14 | **Not run for candidates.** B3 includes real native hold/hand-back; all candidate races remain unproved. |
| A4 Write approval | T15 | **Not run; admission gap.** Universal exact browser-write gate is not current baseline behavior. |
| A5 Secret redaction | T16 | **Not run for candidates.** Existing synthetic text/step tests in B1 are not universal pixel/secret proof. |
| A6 Egress/audience | T17 | **Not run for candidates.** B1/B3 cover existing policy cases, not extension/subprocess containment. |
| A7 Prompt injection | T18 | **Not run.** No live-model hostile-page experiment performed. |
| A8 Offline | T19 | **Not run for candidates.** No network failure benchmark or new bounded-cancellation claim. |
| A9 Missing key | T20 | **Not run for Pomerado.** Source facts/missing-key design are not runtime evidence. |
| A10 Regression | T21 | **Baseline recorded, not globally passing.** B1 has1failure; B4 has7. Product source unchanged by this docs packet; no candidate rerun claimed. |
| A11 Comparison | T22 | **Not run.** Matched model/task runs0 per arm; functional smoke durations cannot substitute. |
| A12 Platform | T23 | **Partial baseline only.** Existing engines tested natively on Intel Mac. Both candidates and other native platforms not tested. |

## Traceability and gate

| Spec scenario / requirements | Planned tasks | Acceptance |
|---|---|---|
| S1 open-ended; R1/R2/R6/R8 | T02–T05, T16–T19, T21–T23 | A5/A6/A7/A8/A10/A11/A12 |
| S2 repeated site; R1/R2/R3/R5/R6/R7/R8 | T03/T04/T06/T07/T10–T13/T15–T17/T20–T23 | A1/A2/A4/A5/A6/A9/A10/A11/A12 |
| S3 approved write; R2/R5 | T08/T09/T10/T15/T17/T18 | A4/A6/A7 |
| S4 takeover; R2/R3/R4/R5/R6 | T08/T12–T17 | A1/A2/A3/A4/A5/A6 |
| S5 offline; R1/R2/R4/R5 | T13/T15/T19/T23 | A2/A4/A8/A12 |
| S6 optional key; R1/R5/R7 | T06/T10/T11/T15/T20/T21 | A4/A9/A10 |

C1→T03/T05/T06/T09/T10; C2→T08/T12/T13; C3→T08/T15–T18; C4→T13/T14/T19; C5→T11/T20; C6→T01/T21/T23; C7→T02/T04/T07/T22; C8→T09/T10/T20/T24; C9→T07/T24.

**G0 deliverable:** six docs, exact baseline evidence, clarified source facts, no-adoption recommendation, ordered gated work, unresolved items, owner identity and secret-scan receipts. **Stop before T02 until go.** No candidate implementation, flag or package installation is complete or claimed.
