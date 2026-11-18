# Current-code failure diagnosis — 2026-11-13

## Conclusion

The highest-confidence current faults are destructive registry recovery, conflicting/unsafe restart decisions, obsolete first-run routing, blocked live UI projection, false credential health, and false room-send failure. Fresh desktop telemetry and Live paid-use admission also do not meet the recorded-consent requirement. These are different from missing future features or an old failing test name.

Research only: no application source changed, permanent tests added, broad checks rerun, real providers called, microphone/computer controlled, live user data inspected or remote state mutated. Owned temporary homes, pages, module loaders, processes and fixture files were cleaned. This report ranks actual causal findings, not the entire completion roadmap.

## Snapshot and proof rules

The checkout remained on `fix/dani-onboarding-updates-compact-sidebar`, HEAD `3a7797656f`, with190 unstaged/36 untracked entries at diagnosis start. The working tree is concurrently changing and is not equivalent to HEAD. Relevant source hashes were captured for fresh probes; line references name the observed serving implementation.

- **CONFIRMED:** current exported modules or real renderer components were exercised in owned fixtures. The scope of each probe is stated; a mounted StoreProvider is not a packaged Electron result.
- **SOURCE-CONFIRMED:** a deterministic integration mismatch is established by current code, without an exercised full workflow.
- **EARLIER PROOF / UNCHANGED PATH:** prior controlled evidence is retained, with the current path checked rather than blindly rerunning it.
- **UNPROVEN:** no real external duplicate, bill, memory exhaustion, credential leak or native acoustic result is invented from synthetic evidence.

### Important supersession

Do not carry the old four-failure integration summary forward as four current product bugs. Newer retained reports show:

| Report | Observed scope/result | Meaning |
| --- | --- | --- |
| `.omb-scratch/supervised-blocker-final-green.json` | success=true;7 passed,0 failed,15 pending; start1794559779824 | The older declared-browser/Chief-blocker cases have subsequent scoped passing evidence. Not the full suite. |
| `.omb-scratch/proxy-reviewed-contracts-green.json` | success=true;78 passed,0 failed; start1794559779739 | The earlier configured-provider/fixture-contract area has subsequent scoped passing evidence. Do not rebuild those corrections. |
| `.omb-scratch/restart-ownership-audit-red.json` | success=false;4 failed,23 pending; start1794560924429 | Different restart/answer-ownership cases failed in that run. Source subsequently gained/changed answer and verification guards during this investigation, so this record alone does not prove all four still fail now. No confirmation rerun was performed. |

The findings below are grounded separately in fresh probes and stable source seams. No current integrated/installed release is certified.

## 1. P1 — Registry load failure can overwrite the user's roster

**CONFIRMED with the actual `Store` implementation.**

**User-visible failure:** malformed `bots.json` is interpreted as an empty workspace; normal starter seeding overwrites the existing file. Malformed `groups.json` likewise becomes empty and a subsequent room creation overwrites it. A valid JSON object such as `{}` instead reaches array operations and crashes construction with `TypeError: this.bots is not iterable`.

**Cause:** [Store constructor339–347](../../server/store.ts#L337-L349) catches every read/parse error and substitutes `[]`, with no unreadable-existing-file barrier. [needsSeed/seedIfEmpty](../../server/store.ts#L2362-L2367) then treats that as a new installation. [createBot](../../server/store.ts#L1377-L1388) and [saveGroups](../../server/store.ts#L720-L725) write the new state. [OwnedFile](../../server/atomic.ts#L126-L134) tracks prior content, not whether a failed load may be safely replaced. Wrong top-level JSON is not validated before spreading the value.

This is a production startup chain, not just a callable library function: [testedAi.seed](../../server/tested-ai.ts#L315-L320) invokes `seedIfEmpty`; the server wires that startup seeding. Routines already have the appropriate contrasting behavior: [an unreadable flag](../../server/routines.ts#L347-L359) and [write protection](../../server/routines.ts#L1521-L1546).

**Fresh probe:** four separate `node --experimental-strip-types --input-type=module -e` processes imported the actual Store after isolating HOME/data, then executed construction and ordinary seed/create operations. Diagnostic exits2 identify the unsafe outcomes; no test runner was used.

| Input / operation | Observed result | Original registry bytes |
| --- | --- | --- |
| Missing registry, normal new-install seed | One starter created; control succeeds | No prior file to preserve |
| Malformed bots JSON, `seedIfEmpty()` | Empty roster accepted, starter written | Replaced |
| `bots.json = {}`, construct | `TypeError: this.bots is not iterable` | Preserved, but construction fails |
| Malformed groups JSON, create a room | Empty room list accepted, new room written | Replaced |

**Boundary:** original roster/room registry bytes were overwritten in the disposable fixture. This does not prove every transcript database row is deleted. Source [transcript startup handling](../../server/store.ts#L604-L616) does not itself justify that stronger claim.

**Smallest correction:** distinguish ENOENT/new install from unreadable/invalid existing state; validate top-level/schema shape; refuse seeding and registry writes until repair. Preserve original bytes and expose a repairable state rather than migrating all storage.

## 2. P1 — Restart safety decisions fail open, and routines can override the runtime's stop decision

**CONFIRMED at the actual runtime/routine module boundary with real SQLite and owned synthetic target receipts. No real email, payment or browser form was repeated.**

There are two independent causes.

### A. Unknown/unreadable outward evidence becomes “safe to rerun”

[Runtime.open94–113](../../server/runtime/runtime.ts#L94-L113) blocks a cut turn only when `outward.length > 0`; otherwise it queues one rerun. [outwardOf895–899](../../server/runtime/runtime.ts#L895-L899) converts an unavailable/throwing outward port into `[]`. The restart caller does not treat that read error as an unresolved effect.

The [outward classifier](../../server/turn-outcome.ts#L131-L153) recognizes selected send-like tool names and shell/git/money patterns. A browser click named `mcp__browser__agent_browser_click` is not classified as outward, even when that click submitted a form. A completed tool label is not a full effect disposition.

### B. Routine startup has another retry decision

[routines.ts362–370](../../server/routines.ts#L362-L370) independently requeues a cut bot run once whenever no pending runtime work is reported. It does not consume the runtime's terminal outward-effect disposition. [requeueOnce](../../server/routine-recovery.ts#L134-L151) changes the run back to queued and supplies a model instruction to check prior work; an instruction is not enforcement.

Production wiring matters: [runtimeWorkPending](../../server/index.ts#L7360-L7366) is false for the already-terminal interrupted root. [RoutineManager wiring](../../server/index.ts#L9199-L9207) uses that predicate; [onRunCut](../../server/index.ts#L9283-L9284) cancels old work but does not veto the routine retry based on a terminal external-effect result.

**Fresh diagnostic results:** actual Runtime begin/store/open/tick and actual RoutineManager create/runNow/restart/tick were used. The target was a separate owned receipt file; controlled host callbacks wrote the intended synthetic operation. This proves replay admission and the conflicting owner decisions. The synthetic host did not interpret the natural-language retry note, so the table is not a claim that every real model would repeat an external action.

| Case | Target receipts before/after recovery | Recovery result |
| --- | --- | --- |
| Recognized `GMAIL_SEND_EMAIL` | 1 /1 | Runtime failed/interrupted; no new dispatch. Correct control. |
| Same recognized send, only outward-history read throws | 1 /2 | Runtime queued a rerun, dispatched once, then completed. |
| Completed unrecognized browser-click label | 1 /2 | Runtime classified no outward action and reran. |
| No earlier effect | 0 /1 | One recovery dispatch. Correct control. |
| Runtime protects recognized send, then routine manager restarts | 1 /2 | Runtime says interrupted/not resumed; routine becomes queued/restarted and dispatches another turn. |

The routine probe captured the original runtime detail: `Interrupted by a Dani Bot restart after it already sent an email (GMAIL_SEND_EMAIL); not resumed, so nothing is done twice.` The independently restored routine nevertheless queued and started again.

**Smallest correction:** preserve an explicit unknown/error disposition instead of interpreting failed evidence reads as empty evidence; persist consequential attempt/receipt state and make every recovery owner consume it. Keep specialized idempotency and browser fences. Do not fix this by adding all click names to a “safe” list, adding more prompt warnings, or inventing another scheduler.

## 3. P1 — Fresh onboarding ignores working Hermes and starts the old setup flow

**CONFIRMED in managed Chromium mounting the real MeetScreen/DaniSetup/useWelcomeAi components.** Backend responses were intercepted synthetic data; no app instance or provider was contacted.

**Preconditions:** fresh local profile; default starter not yet welcomed; starter already selects Hermes; Hermes available/authenticated, with an available model and `aiTest:passed`.

**Observed:** primary buttons were `Set up Dani`, `Other ways to connect`, `Set up later`, not Next. Primary setup requested `dani/install` and `dani-client/install`; it never checked Hermes. Injected legacy-install refusal produced the actual renderer's free-model connection failure. Those injected404 statuses are not a claim that every production install request returns404.

**Cause:** [MeetScreen61–66](../../src/components/onboarding/MeetScreen.tsx#L61-L66) excludes the fresh default starter from explicit selection and filters candidates to legacy free IDs or that explicit choice. [MeetScreen93–105](../../src/components/onboarding/MeetScreen.tsx#L92-L108) then directly renders `DaniSetup`. [FREE_ROUTES and activation](../../src/components/onboarding/ConnectAi.tsx#L17-L76) still point to `dani`/`dani-client`, even when absent from the visible fleet.

**Controls:** returning, explicitly selected, welcomed and hosted states showed Next with the same working Hermes. Returning-but-unchecked Hermes correctly called `hermes/check` and reached Next. Set up later worked, so this is not a demonstrated hard lock.

**The secondary card is not a repair:** Other ways to connect displayed `Hermes / Choose a model for this bot` with zero actions inside that card. [ConnectAi's Hermes branch](../../src/components/onboarding/ConnectAi.tsx#L127-L139) renders a paragraph when a catalog exists; it does not change the primary candidate filter or supply a chooser there.

**Backend caveat:** default materialized configs and explicit Hermes-only persisted configs behave differently when legacy activation runs. The latter can incrementally load missing legacy instances through `ensureDaniInstances → persistProviderInstance → registry.load`, bypassing the startup fleet filter. No legacy-agent execution bypass was demonstrated. Do not simplify this to universal404 or a proved harness-authorization escape.

**Smallest correction:** use one current Hermes readiness/setup path on the primary screen; recognize/test the actual starter and offer a real model-selection action when needed. Centralize allowed-fleet activation policy instead of retaining a second legacy install route in onboarding.

## 4. P1 — An optional settings request can stop live chat updates while the app looks connected

**CONFIRMED using the actual exported boundary and mounted StoreProvider in an owned DOM/module harness. Not a full packaged-window result.**

**Observed:** chat REST data loaded, bots rendered and React state said hydrated; the SSE transport remained open. A never-settling `/api/config` held the separate stream gate closed. Incoming messages were buffered rather than applied. Releasing only that optional request applied the entire injected message batch. An independently rejected peripheral's retry callback was also delayed behind the hung request.

**Cause:** [loadSnapshotBoundary](../../src/state/store.tsx#L2080-L2094) waits for `Promise.allSettled([chat, ...every peripheral])`. [loadAll](../../src/state/store.tsx#L3075-L3099) can mark React state hydrated before that boundary completes; [effect-local hydration](../../src/state/store.tsx#L3103-L3128) remains false and [onFrame](../../src/state/store.tsx#L3293-L3304) keeps queuing. [api](../../src/state/api.ts#L26-L45) supplies no deadline unless the caller passes one; initial peripheral fetches do not.

| Controlled boundary state | Incoming message frames applied to Store |
| --- | ---: |
| Config unresolved, successful chat REST, healthy stream | 0 |
| Only config released, same stream/messages | 128 |

**Important controls:** the pending snapshot did not prematurely commit its SSE cursor; abandoned-generation completion could not commit; successful completion advanced it correctly. Existing out-of-band frame observers can still run. Therefore this is stale live projection, not a proven universally blank app or silent stream data loss.

The pending frame array has no count/byte cap; retention was exercised for the bounded batch above. OOM, production memory growth rate and an infinite-duration incident were not measured.

**Smallest correction:** let successful chat govern the live-projection boundary; handle/timeout peripherals independently. Retain generation/version protection so late peripheral snapshots cannot overwrite newer events. Bound remaining recovery buffering with an explicit resync path; dropping frames while advancing their cursor would create a different bug.

## 5. P2 — Credential UI reports Connected without verification and forgets a rejection

**CONFIRMED in the actual KeyRow/SavedKeyLine browser components.**

A configured-only OpenAI key with no verification showed Connected without a check. Check again received a synthetic provider rejection: the row changed to Didn't work while SavedKeyLine stayed Connected. Remount restored Connected without any new successful check.

**Cause:** [KeyRow150–156](../../src/components/keys/KeyRow.tsx#L150-L156) and [SavedKeyLine48–60](../../src/components/keys/KeyRow.tsx#L48-L60) treat existence of `target.test` as success. Actual check verdict/problem state is local to the row and is not part of [saved key status](../../src/state/config-status.ts#L6-L7). Hermes-only instances do not provide the old per-key API-instance rejection snapshot that could override it.

**Controls:** a configured DeepSeek entry without test/verifiedOnSave showed Saved. Save can actually run checks, and some `verifiedOnSave` entries have genuine server-side save verification. “Keys are never tested” or “all connected labels are fake” would be false. A real revoked account was not contacted; the rejection in this probe was synthetic.

**Smallest correction:** `target.test` means checkable, not verified. Use Saved for configured-only state and one credential-scoped verdict for row and summary. If health survives remount, persist/invalidate real verification evidence rather than a configured boolean.

## 6. P2 — Room send reports failure after its message has already arrived

**CONFIRMED at the actual mounted StoreProvider action/reducer boundary.**

Controlled room POST transport loss invoked onError and reported an error even when an accepted canonical message had already arrived over SSE. In the inverse ordering, a later SSE restored the message without another POST.

**Cause:** direct sends use [sendReconciled](../../src/state/optimistic-send.ts#L34-L52); room [sendGroup](../../src/state/store.tsx#L2705-L2749) uses a raw API request and unconditionally reports catch/onError. Composer wires that callback to draft/outbox recovery. The user can see a successful message alongside a failed-send/draft state.

**Counterevidence:** canonical messages are not removed by the optimistic-only deletion; room reducer dedupe and server sendId sequencing exist; unedited Composer retries preserve sendId. Durable message loss and duplicate execution were not established and are not claimed.

**Smallest correction:** reuse room/thread-specific send reconciliation with the original sendId, while preserving true API refusals and avoiding deletion of a newer draft. Later SSE reconciliation of an already-restored draft is a separate narrow UX case.

## 7. P2 — Fresh desktop analytics starts without a recorded choice

**CONFIRMED through actual desktop preference exports, native IPC registration, full preload and actual analytics exports with an instrumented SDK. No real PostHog traffic or personal payload was sent.**

Fresh native preference returned null; renderer enabled analytics without writing a choice, then invoked SDK init plus first/open captures. Native preference-read failure did the same. Saved native false and legacy opt-out migration correctly prevented initialization.

**Cause:** [desktop preference storage/IPC](../../electron/desktop-prefs.mjs#L49-L78) treats absent analytics as null. [Preload](../../electron/preload.cjs#L79-L82) preserves null. [analyticsEnabled](../../src/lib/analytics.ts#L21-L29) interprets no opt-out as enabled and also returns true on storage failure; [initialization](../../src/lib/analytics.ts#L72-L106) runs on application mount. Current behavior follows an opt-out model; the accepted local-profile/telemetry contract requires recorded consent.

**Smallest correction:** unknown/read-failed preference stays disabled until an affirmative saved choice; preserve opt-out precedence/migration and keep local onboarding independent of remote analytics. This is not evidence the opt-out switch is ignored or a legal finding about a real user's past consent.

## 8. P2 / consent contract — Live session creation is outside the required paid-use admission

**CONFIRMED using the actual route/controller/key selector/provider-session function with an owned rejecting loopback provider.**

A synthetic saved OpenAI key let an authorized Live start issue a provider-session POST before any ordinary Hermes send or separate provider/model/cost acknowledgement. No-key control refused. The loopback provider rejected the request; there was no real bill, successful call or microphone/media.

**Cause:** [Live route](../../server/routes/live.ts#L53-L61) calls [controller.start](../../server/live-call-controller.ts#L147-L159), which checks key presence and invokes provider session creation. [Key selection](../../server/live-settings.ts#L6-L10) accepts a separate Live key or generic OpenAI key; [createLiveSession](../../server/live-call.ts#L140-L165) sends the voice-provider request before later spoken delegations reach ordinary task admission. Readiness/ordinary spend gates cannot protect this earlier ingress.

**Important qualifications:** a GUI call is intentionally started by the user and existing settings/menu text discloses cost. This is a missing server-enforced recorded acknowledgement against spec010 R8, not no disclosure, auto-calling, unauthorized access or demonstrated billing abuse. Actual voice-session acceptance, app budget overrun and real-provider compatibility were not proved.

**Smallest correction:** one server-authoritative first-use spend check before provider-session creation, bound to the actual voice provider/model/key scope; do not inherit unrelated Hermes consent or treat saved key presence as the required acknowledgement.

## Additional source-confirmed limitations — not promoted into freshly exercised incidents

- **Hermes proactivity integration:** [the read-and-draft fence](../../server/host/proactive.ts#L35-L36) admits `claudeAgent`, while ordinary production bots use Hermes. [Meeting-prep/nonhelper AI mail branches](../../server/host/routine-checks.ts#L209-L210) refuse/skip unfenced AI work. Deterministic brief/read/schedule paths and helper-specific paths can still function; not all routines are dead. Removing the fence would widen authority rather than fix compatibility.
- **Voice cancellation/modality/clean bootstrap:** missing required hooks or qualification in the prior plan remain source/evidence work, not microphone, vision or clean-machine failures exercised here. No native acoustic/physical-device or Linux-vault-leak result is claimed.
- **Custom executable probes:** actual probing accepts extra wrapper arguments, relative paths and uncanonicalized symlinks. Ordinary Settings selection and Save is explicit owner intent; packaged bare, shared-service bare and hostile-origin controls refused. This is a narrower fixed-argv/canonical-path contract gap, not demonstrated unauthenticated RCE or shell injection.
- **Explicit solo goals:** earlier isolated evidence showed a completed goal card without assignment ownership; current goal/card-continuation integration still has that separate lifecycle. It is not the same as saying ordinary direct work or room steps lack roots. This earlier proof was not rerun just for confirmation.

## Evidence sources and reproducibility

Parent probes executed actual exported modules as inline Node programs through Eval, with a new temporary HOME/data/SQLite/target directory per case. Runtime diagnostics returned2 only when the explicitly checked unsafe disposition occurred; controls returned0. The receipt target was an owned local file, not an external account. All created directories were removed in finally blocks.

Specialist probes retained these sanitized session notes; their removed script paths are evidence of executed commands, not promises that a deleted script still exists:

- `local://current-code-fresh-user-diagnosis.md` and `local://fresh-user-renderer-probe-evidence.json`: real components in managed Chromium, nine predicates and state controls.
- `local://current-code-client-recovery-diagnosis.md`: actual StoreProvider/boundary and transport cursor probes; Node commands exited0 after all diagnostic assertions.
- `local://current-code-spend-privacy-diagnosis.md`: isolated actual-function/loopback-provider, native-preference/preload/analytics and benign CLI probes; SDK/network instrumentation prevented real telemetry/provider use.

Selected observed source SHA256 values:

```text
b8bf9aa104651859141c724ca1c8e2ca9fd0d66d5674c98dd677059919581a6e server/store.ts
79f6054a5f75ed860b50e08907f0bbe04989948c448ddfa3d71eb7b8f568914b server/atomic.ts
8cbbbee8e3e0f443a0857d3273aaa07d9201f84a2e22a78d58aba2aafc873097 server/routines.ts
621e108bfccacb91baa4bdef1faa14196303d6d205567e7968961aa0bac93202 server/routine-recovery.ts
63f4733448ce62267a5d1d8d2b94c02ca551d22f79fc7d5f84cc67165e3f240c server/runtime/runtime.ts
752b8aa846415d043a2e4bfc357f2913f0dbd278010a5532775e7c9df93b8d24 server/turn-outcome.ts
8bade38b52b2ffb6eb84ac0beb03b9c09acff595604a648237f9133e89a1051e src/state/store.tsx
0d583bcf1804af7867db50a3d8b392875e562f2b9bdd8ee0c9399d7dcadab63b src/components/onboarding/MeetScreen.tsx
ab8209ec478cf84c91341906fafa7e4d9ddc43b5adf7ef9e0ffe614849c3903d src/components/keys/KeyRow.tsx
b0c5ef0943ecd6f305d15bc2b98775c47a1cdac76ae99e9f84bd498d0041fd41 src/lib/analytics.ts
```

Core specialist target hashes were stable across their probes. Volatile index/runtime/test changes outside captured intervals must be re-read before implementing a fix. This is bounded root-cause evidence, not a full repository security audit, integrated suite pass, installed-app/device qualification or claim that no other defects exist.
