# Completion work packages

All implementation boxes are intentionally unchecked. Writing/reviewing this plan does not implement a task, authorize a provider bill/native action, or approve publication. [Phase/dependency plan](plan.md) · [Requirement gates](spec.md) · [Current evidence](traceability.md).

A package may need several small changes; keep independent behavior changes separate. Each change records requirement IDs, actual interface/callers, failing behavioral evidence, serving-path smoke, applicable native proof and rollback. Reuse existing tests where they cover the outcome; add only missing consumer-visible invariants. Remove incidental wording/source/cardinality assertions rather than re-pinning them.

## A — Candidate and retained-failure reconciliation

### C-00 — Establish the integrated candidate and current evidence ledger

- [ ] **Owner:** integration maintainer. **Requires:** no destructive action; preserve all user changes. **Maps:** R-160-012/A-160-12.
- **Files/surfaces:** `specs/README.md`, the current packet, `docs/current-ci-contract.md`, `docs/handoff/latest.md`, existing specs120/130/140, canonical tracker21, `.github/workflows/ci.yml` and release candidate metadata.
- **Change:** reconcile historical versus current owners/evidence; identify the approved source candidate and its actual required CI. Carry forward the correct scoped passes and unresolved failures. Integrate user changes through review, not reset or blanket staging. Record all actual failed/skipped/unrun gates.
- **Done:** one candidate identity and requirement/evidence matrix; current required checks complete before promotion. Remote main, local working tree and packaged binary are not conflated. The previous `prod`/tracker15 directions do not govern new work.

### C-01 — Close the retained supervised-completion failure

- [ ] **Owner:** runtime maintainer. **Depends:** C-00; cross-entrypoint/crash closure also depends on C-07–C-10/C-12. **Maps:** R-160-007/A-160-07; spec140 AC001/002/003 and R015.
- **Files:** `server/long-running-chief.e2e.test.ts:705-770`, `server/runtime-coordinator.ts`, `server/runtime/runtime.ts`, `server/index.ts:2093-2113,2228-2243`, `server/host/one-on-one-goals.ts` only where the shared contract requires it.
- **Change:** diagnose the already retained declared-browser/authorized-Chief failure using original request ownership and authoritative transitions. Preserve the existing adoption/receipt/readmission mechanism. Do not add another judge/supervisor or weaken the waiting/needsVerification requirement.
- **Done:** a text-only browser blocker never certifies completion; an authorized Chief issues safe concrete remaining work; a late Chief grant resumes the same original root once. Stop, newer input, genuine cards, unknown effects, budgets and the original/current grant ceiling block unauthorized resumption. Real-model Chief-chain proof is attached in C-22, separately from deterministic regression evidence.

### C-02 — Correct provider fixture isolation; implement verified health and cost consent

- [ ] **Owner:** provider maintainer. **Depends:** C-00; installed closure needs C-04/C-21. **Maps:** R-160-005/A-160-05; specs040/070 and 010 R8.
- **Files:** `server/drivers/acp/hermes-configured-providers.test.ts`, `server/drivers/acp/hermes-model-catalog.test.ts`, `server/drivers/acp/hermes-configured-providers.ts`, `server/drivers/acp/hermes-model-catalog.ts`, `server/provider-key-check.ts`, `server/contracts.ts`, `src/components/keys/KeyRow.tsx`, `src/components/keys/key-catalog.ts`, `src/components/ModelPicker.tsx`, ordinary turn admission in `server/index.ts`, `server/routes/live.ts`, `server/live-call-controller.ts`, `server/live-call.ts`.
- **Change, in separate slices:** isolate fixture-owned providers instead of assuming an empty config means an empty fleet; retain no-contact/credential/protocol/refusal assertions. Preserve the seven boundary negatives already passing. Then persist/invalidate dependency-appropriate verification and make saved/authenticated/catalog/tool-ready labels distinct. Inventory billable ingress and enforce explicit first-metered/unknown-billing acknowledgement server-side before any provider request, including ordinary tasks and Live session creation. Bind Live consent to the actual voice provider/model, not the bot's Hermes selection; a saved voice key, picker warning or probe consent is insufficient.
- **Done:** invalid/revoked credentials, stale checks, public catalog without auth, quota/version/network failures and native model refusal remain unavailable with safe reasons. Saved key type alone cannot say Connected. Direct API/CLI/GUI cannot bypass required paid-use consent; no-consent task and `POST /api/live/session` negatives make no provider request even with a saved key. Supporting credentials are never borrowed from unrelated native clients. The per-supported-provider live release matrix is a separate required closure in C-22; C-03 implementation depends on these contracts, not completion of installed/live qualification.

## B — Honest first run and authority

### C-03 — Complete Hermes-first onboarding, readiness and modality intersection

- [ ] **Owner:** onboarding/renderer maintainer with provider maintainer. **Depends for implementation:** C-02 readiness/consent contracts, not its later live/installed release closure; full clean-install proof depends on C-04. **Maps:** R-160-005/006; A-160-05/06.
- **Files:** `src/components/onboarding/MeetScreen.tsx`, `src/components/onboarding/ConnectAi.tsx`, `src/components/ModelPicker.tsx`, `src/lib/model-choices.ts`, `server/headless/commands.ts`, `server/default-model-selection.ts`, `scripts/control-omb.ts`, `server/drivers/acp/hermes.ts`, `server/drivers/acp/core.ts`.
- **Change:** remove obsolete free-harness activation from the fresh primary screen and route it through the current Hermes runtime/provider state. Make doctor/process availability separate from usable task readiness. Align fake-native qualification with the real contract. Compute image/tool availability from model and actual transport; qualify structured image delivery or mark it unavailable without breaking existing screenshot/file tools.
- **Done:** fresh, returning, no-model, signed-out, unavailable and repaired states render truthfully. The canonical Hermes fixture completes an admitted turn without broadening eligibility. A real qualified route consumes an unpredictable tool result and a known image when images are advertised. Unsupported input fails before dispatch. Skip/settings/optional QR pairing remain usable.

### C-04 — Deliver the specified pinned managed-runtime bootstrap

- [ ] **Owner:** desktop/runtime packaging maintainer. **Depends:** C-00; legal payload/native-runner prerequisites are external. **Maps:** R-160-006/A-160-06; spec110 BOOT/RUNTIME requirements.
- **Files:** `electron-builder.yml`, `scripts/bundle-server.mjs`, `server/drivers/acp/hermes.ts`, current runtime/config/route factories and the existing spec110 bootstrap interface. The missing activation module must be designed at that seam; do not resurrect an absent historical kernel or install into the user's global home.
- **Change, in target-bounded slices:** establish exact Hermes/interpreter/dependency payload provenance, redistribution rights, hashes, architecture and size; implement verified safe extraction, locked versioned atomic activation, live protocol probe, prior-verified retention and actionable limited/repair states. App-owned Python helper scripts alone are not the runtime payload.
- **Done:** a clean supported installer prepares runtimes offline without Terminal/pip/npm/global PATH changes. Corrupt/unsafe archive, missing dependency, unsupported version, concurrent launch, cancellation, crash, disk/ACL/antivirus failure cannot activate an unverified payload or destroy the last verified runtime. No legal/free-capacity assumption or hidden paid route closes the zero-step promise; unresolved entitlement is recorded as a blocker or approved requirement amendment.

### C-05 — Coordinate repair/reload while work is active

- [ ] **Owner:** provider/runtime maintainer. **Depends:** C-03/C-04; effect-safe recovery needs C-09/C-10/C-12. **Maps:** R-160-001/003/006; tracker P-01/P-02/P-03.
- **Files:** `server/harness/registry.ts`, provider reload/task-ready wiring in `server/index.ts`, `electron/server-supervisor.mjs`, `electron/environment-switch.mjs`, current desktop startup and protocol lifecycle.
- **Change:** use the established dispose/load/attach lifecycle and coordinate activation with current turn/profile ownership. Do not create another task-ready reload path or replace a live runtime optimistically.
- **Done:** repair/update/settings reload during direct and room work leaves no orphaned busy state, lost accepted reply, detached second owner or duplicate external operation. Failure retains a usable verified runtime or explicit limited mode. Package proof uses the current bootstrap, not an absent Sep23 test path.

### C-25 — Preserve the accepted free-route canary gate

- [ ] **Owner:** provider verification maintainer. **Depends:** C-02/C-03 qualification contracts, C-04 managed runtime, a lawful compatible free route and authorized no-charge account/budget evidence; installed execution uses C-21 candidate bytes, not public publication. **Maps:** R-160-005/006/012; tracker P-04; spec110 R-MODEL-005.
- **Surfaces:** existing provider qualification/check interfaces, CI workflow/configuration, installed app smoke and the current native route. Do not recreate a restricted-client bridge.
- **Change:** implement a versioned canary that runs in CI and against the installed app, with an explicit authorized live/no-charge lane and a controlled request/response-shape incompatibility negative.
- **Done:** both CI and installed results establish current compatible behavior; a forced shape/protocol change produces an actionable safe error and no silent model/harness/paid substitute. Missing entitlement, payload or authorized execution remains blocked/unrun, not a skipped pass. P-04 stays open unless these obligations pass or an explicit amendment revises the canary itself as well as any zero-account promise.


### C-11 — Separate owner, worker, remote and restricted-agent authority

- [ ] **Owner:** security/server maintainer; external worker owner for the client cutover. **Depends:** C-00, explicit trust matrix before migration. **Maps:** R-160-004/A-160-04; spec010.
- **Files:** `server/request-auth.ts`, `server/request-auth.test.ts`, `server/routes/instances.ts`, `server/cli-probe.ts`, internal capability admission in `server/index.ts`, `electron/server-session.mjs`, `electron/local-origin.cjs`, relevant preload/Companion/remote-client ingress. A current test names `openmaus-cloud/server/slack-worker.ts` as the external worker caller; that source is not in this checkout.
- **Change:** give the worker scoped credentials, migrate the real caller and remove the sessionless worker fallback. Reconcile desktop/dev/headless/CLI read/mutation policy with the stricter spec010/P-06 contract. Separately close spec010 R7: `/api/cli-test` accepts a discovered-adapter identity, or a canonical custom executable previously explicitly selected by the owner, with fixed no-shell arguments; caller authentication alone is not executable selection. Preserve packaged mutation tokens, paired sessions and browser-only dispatch fences; identify trusted native versus restricted modes.
- **Done:** wrong/missing/revoked worker credential, wrong workspace/audience, agent-shell loopback, wrong frame/origin, stale capability and unpaired device cannot gain unauthorized access. Arbitrary/unselected executable paths, relative-path ambiguity, changed canonical target and shell/argument injection cannot execute through the probe; discovered adapters and explicitly selected custom paths still work. Legitimate worker/desktop/CLI/remote paths retain their intended principal. External client code/deployment is a real prerequisite, not permission for a compatibility bypass.

## C — Durable execution and recovery

### C-06 — Fail closed on unreadable authoritative registries

- [ ] **Owner:** persistence/runtime maintainer. **Depends:** C-00. **Maps:** R-160-001/009; A-160-01/09.
- **Files:** `server/store.ts:336-348,489-495,713-725`, `server/atomic.ts:118-140`, `server/routines.ts:1521-1541`, existing store/filesystem regressions.
- **Change:** distinguish absent-new-install from malformed/unreadable-existing bot/group state and reuse the established write-refusal/repair pattern. Preserve original bytes and known relationships; do not silently replace failed loads with a new empty registry.
- **Done:** invalid JSON, wrong shape, permission/I/O failure and interrupted migration cannot be overwritten by create/import/start/seed/save. Restoring valid bytes restores prior owners, tasks and grants. The existing member-pruning guard remains effective.

### C-07 — Reconcile immediate message acceptance and root creation

- [ ] **Owner:** runtime/persistence maintainer. **Depends:** C-06; agree identity with C-08 before changing exported contracts. **Maps:** R-160-001/A-160-01; 020 storage safety.
- **Files:** `server/index.ts:7614-7641,8052-8154`, `server/message-db.ts`, `server/runtime-coordinator.ts:303-338`, `server/runtime/store.ts`, `server/routes/bot-messages.ts`, existing accepted-send/follow-up tests.
- **Change:** establish a durable admission/repair record across current transcript/root stores so an inserted send cannot permanently lack an explainable execution. Keep follow-up FULL-sync claims and canonical send identity; choose reconciliation instead of a wholesale storage migration.
- **Done:** message commit followed by root/registry failure, pending-marker failure, response loss and duplicate ingress converge to one canonical accepted message and one durable job or explicit admission failure. No held setup claim, double provider dispatch or silent orphan survives restart/retry.

### C-08 — Give explicit solo goals durable runtime ownership

- [ ] **Owner:** runtime maintainer. **Depends:** C-07 identity; package/restart closure also needs C-09/C-10/C-12. **Maps:** R-160-001/007; A-160-01/07.
- **Files:** `server/host/one-on-one-goals.ts`, `server/host/goal-cards.ts`, `server/group-goal-run.ts`, `server/index.ts:8143-8154`, `server/runtime-coordinator.ts`, `server/routes/jobs.ts`, goal/runtime-root behavioral suites.
- **Change:** bind explicit mode-goal run/card/steps to the existing assignment owner. Preserve ordinary direct roots, room goal step roots, busy/resource waits, finite budgets and the existing UI. Do not replace the loop merely to move it into another manager.
- **Done:** the reproduced completed-card/empty-ledger case gains stable durable identity; card, job API and CLI agree while running, waiting, blocked, stopped and completed. Duplicate send identity creates no extra root; restart reconciles rather than abandoning a working card or repeating a completed step.

### C-09 — Add durable disposition for one mediated consequential operation

- [ ] **Owner:** runtime/tool-adapter maintainer. **Depends:** C-07/C-08 identity; native replay claims also require C-12. **Maps:** R-160-002/A-160-02; RC-003/006/009/010/013.
- **Files:** `server/runtime/types.ts`, `server/runtime/store.ts`, `server/runtime/runtime.ts`, `server/browser-calls.ts`, browser internal dispatch in `server/index.ts`, `server/turn-outcome.ts`, existing target-receipt browser fixtures.
- **Change:** first pick one already mediated target operation and persist intent/approval/resource/generation, immutable attempts and observed receipt/non-application/unknown in the existing owner's storage. Integrate read-only reconciliation and target-native idempotency when supported. Keep raw secrets out; preserve specialized existing journals and live uncertainty fences.
- **Done:** failures before dispatch, after target commit/before receipt, after receipt/before response, during inspection, or with unreadable evidence produce one verified intended target effect or visible unknown. Changed preconditions/approval/owner are not an idempotent replay. A locally generated key is not represented as remote dedupe unless the target honors it.

### C-10 — Make every recovery owner consume the same effect disposition

- [ ] **Owner:** runtime/routine maintainer. **Depends:** C-09 and the native/readmission proof in C-12. **Maps:** R-160-002/003; A-160-02/03; spec130 R-CONT-005/008.
- **Files:** `server/routines.ts:360-378,1271-1285`, `server/routine-recovery.ts`, `server/runtime/runtime.ts:77-123,869-892`, `server/runtime-coordinator.ts`, `server/turn-outcome.ts`, goal completion/incident retry callers.
- **Change:** schedule timing stays in `RoutineManager`, but retry/restart/goal continuation consumes one authoritative outcome/unknown/denial record. An exception reading outward evidence is not treated as an empty safe-to-retry result. Preserve bounded read-only recovery and existing budgets.
- **Done:** a routine or goal whose prior operation committed or is unresolved cannot dispatch a blind replacement; refusal/Stop/quota/budget remain distinct; a genuine transient read may recover within its budget. Queued/never-dispatched work remains recoverable and all outcomes are visible.

### C-12 — Qualify native profile ownership and process quiescence

- [ ] **Owner:** native/desktop maintainer with runtime maintainer. **Depends:** C-00; shared contracts with C-05/C-09/C-10. **Maps:** R-160-003/004; A-160-03/04; HA-008/013 and spec120 native limits.
- **Files:** `server/procs.ts`, `server/drivers/acp/core.ts:1296-1325,1906-1934`, `server/drivers/acp/hermes-provider-env.ts`, `server/drivers/acp/hermes.ts`, `server/engine-homes/engine-homes.ts`, `electron/server-supervisor.mjs`, `server/browser-processes.ts`, current kill-tree/ACP shutdown/native policy fixtures.
- **Change, in separate slices:** define exclusive ownership for app-mutated managed native profiles across workspaces without touching the user's global profile; then close the exact retirement-await/readmission seam the native experiments demonstrate. Preserve existing process-group/start-identity and browser-only constructor/dispatch guards.
- **Done:** two app workspaces sharing one profile, server death, detached/reparented helpers, cancel ACK before actual stop, failed cleanup, PID reuse and late completion cannot permit unsafe replacement or kill foreign/shared work. Current Windows/attached-Chrome limits stay explicit until actual native evidence closes them; ordinary requester Stop does not globally terminate unrelated running teammates.

## D — Product resilience and declared capabilities

### C-13 — Bound renderer recovery and reconcile accepted room sends

- [ ] **Owner:** renderer maintainer. **Depends:** C-00; identity alignment with C-07/C-08. **Maps:** R-160-008/A-160-08.
- **Files:** `src/state/store.tsx:2080-2094,2459-2499,2705-2749,2979-3128`, `src/state/api.ts`, `src/state/optimistic-send.ts`, `src/lib/live-events.ts`, current lost-send/hydration/stream fixtures.
- **Change:** give hydration work a deadline/cancellation owner, let optional loads fail/hang independently, bound pending frames with explicit resync, and extend the existing admission-reconciliation contract where room response loss differs. Isolate observer/effect failures from cursor acceptance where required.
- **Done:** a never-settling peripheral, network gap, duplicate frame, lost POST response and unmount/workspace switch leave bounded memory and usable chat. No accepted send is reissued as new work, no stale workspace mutation is applied, and browser input is not replayed.

### C-14 — Classify secrets, workspace scope and real vault backend

- [ ] **Owner:** desktop/security maintainer. **Depends:** declared installation-wide versus workspace-scoped credential policy; C-00. **Maps:** R-160-009/A-160-09; 010 R5/R6 and 110 R-SEC-001.
- **Files:** `src/components/keys/key-catalog.ts`, `src/components/keys/key-save.ts`, `src/lib/webhook-credentials.ts`, `server/config.ts:946-971`, `server/secret-vault.ts`, `electron/main.mjs:362-444,1145-1160`, `electron/workspace-credentials.mjs`, `electron/secure-credential-state.mjs`, `electron/environment-switch.mjs`.
- **Change, by credential class:** preserve existing async encrypted state/rollback; move classes that violate the accepted trusted-storage promise through the existing appropriate owner. Bind in-flight saves/checks to the intended workspace. Qualify Linux async actual provider strength instead of assuming availability or legacy backend label means OS-vault encryption.
- **Done:** working/missing/locked/fallback storage, two distinct workspaces, switch during save, interrupted migration, stale result, failed rollback and secret-ref replay cannot leak or overwrite recoverable state. Production unsupported storage refuses clearly; any insecure dev mode is explicit/off-by-default. An app-wide key stays app-wide only by declared policy, not accident.

### C-15 — Enforce consented telemetry and accurate memory privacy

- [ ] **Owner:** privacy/renderer maintainer; memory owner for lifecycle evidence. **Depends:** C-00/C-14 scope policy. **Maps:** R-160-009; A-160-09; 110 R-PRIV-001 and 060 R5.
- **Files:** `src/lib/analytics.ts`, `src/App.tsx`, `src/components/onboarding/WelcomeFlow.tsx`, native analytics preference bridge, `server/memory-store.ts`, `server/memory-forget.ts`, `server/memory-journal.ts`, `server/side-jobs.ts`, current recall/upkeep/audience code and fixtures.
- **Change:** local profile persistence stays independent and nonblocking; remote analytics initialization follows explicit recorded consent, including storage/native-read failure. Document/enforce actual memory/helper processing, notes/history/journal/backup retention and forgetting behavior; preserve Markdown/journal/undo rather than introducing the deferred sidecar.
- **Done:** no-consent/opt-out/unavailable-telemetry causes no analytics initialization/network call; failures do not block local setup. Corrected/forgotten current notes do not return via delayed upkeep/recall; cross-audience/private facts and memory instructions cannot gain authority. Broader transcript/backup erasure is a separate product decision, not silently promised.

### C-16 — Finish one safe Hermes proactive proposal path

- [ ] **Owner:** routines/proactivity maintainer. **Depends:** C-09/C-10/C-11; explicit rollout decision for existing auto-watch versus accepted suggestion controls. **Maps:** R-160-002/007/010; spec060.
- **Files:** `server/host/proactive.ts`, `server/host/routine-checks.ts`, `server/read-and-draft.ts`, `server/host/brief.ts`, `server/routines.ts`, `shared/routines.ts`, existing proposal/brief/notification UI paths.
- **Change:** use existing triggers/routine persistence to create one durable reasoned proposal; acceptance enters the shared execution lifecycle. Implement required quiet-hour/rate/dedupe/snooze behavior. Qualify the actual Hermes read-and-draft tool boundary before replacing the current Claude-only refusal; do not widen tools to make it run.
- **Done:** real configured trigger → one proposal → authorized execution → target evidence → proactive report survives restart and Stop. Duplicates, stale accepts, revoked access, quiet-hour/DST boundaries and memory authority injection fail safely. Existing watch migration and flag/default behavior follow an explicit decision; issue23's default-on expansion is not assumed approved.

### C-17 — Close Live cancellation and qualify native voice/computer claims

- [ ] **Owner:** voice/native maintainer. **Depends:** C-02 paid-use ingress contract and C-03/C-10/C-12/C-14 where used; authorized hardware/provider prerequisites. **Maps:** R-160-003/005/010; A-160-03/05/10; spec050 and 010 R8.
- **Files:** `server/live-call-controller.ts`, `server/routes/live.ts`, `src/lib/live-call-media.ts`, `src/components/CallView.tsx`, ordinary turn/cancel admission, `electron/resources/speech-helper.swift`, `electron/capabilities.cjs`, `electron/talk-main.mjs`, `docs/voice-hardware-acceptance.md`, current computer-use gate/verification paths.
- **Change:** require actual voice-provider/model cost acknowledgement before creating a billed Live session, including direct API calls; preserve C-02's shared consent authority. Bind committed speech/reconnect identity to ordinary durable work; implement spec050 barge-in as exact owned task cancellation plus media cancellation—not a global Stop or audio-only. Preserve approval-ID-bound conservative answers. Enforce or accurately qualify Mac on-device recognition; separate dictation/PTT, half-duplex and Live; qualify native computer backends independently.
- **Done:** no-consent Live start makes no provider-session request; consent does not transfer from an unrelated model/voice route. Real microphone, headset/speaker/echo/device-change/denial/network/reconnect/expired-key/hangup cases satisfy physical50-cycle cleanup per claimed voice platform; stale callbacks and duplicate utterances cannot redispatch. Ordinary text works. Unsupported modes, Windows browser-only/hard-stop and Wayland limits remain unavailable until their own proof. Parked Whisper/Kokoro is not part of this package.

### C-18 — Extract ownership and type high-risk serving seams

- [ ] **Owner:** server/renderer maintainer. **Depends:** C-00; perform alongside touched behavior, not as a prerequisite rewrite. **Maps:** R-160-012; spec020/tracker P-08/P-10.
- **Files:** `server/host/README.md`, `server/routes/README.md`, `server/routes/table.ts`, `server/index.ts`, `src/state/store.tsx`, touched `shared/` wire contracts, current build/entrypoint classification tooling.
- **Change:** enumerate method/path/auth/schema/response/owner for the actual routes; use existing factory patterns to move state and decisions with the behavior. Prioritize admission, approvals, projection and shutdown seams. Type/validate consumer boundaries and enforce graph ownership as an architecture check rather than source-word tests.
- **Done:** malformed requests produce deliberate safe4xx, authoritative fields cannot be client-spoofed, imports/callers stay coherent and package/chat/approval/routine behavior remains intact. No second convention or shared bare maps. Old root-line-count/bundle-word criteria stay open until approved amendment or their actual fulfillment; no cosmetic threshold increase counts as architecture completion.

### C-19 — Measure responsiveness before optimizing topology

- [ ] **Owner:** performance/desktop maintainer. **Depends:** C-00 candidate identity; final measurement after behavior changes. **Maps:** R-160-012/A-160-12; HA warm-process decision.
- **Files/tools:** `scripts/bench-desktop.ts`, `scripts/bench-persistence.ts`, `scripts/bench-browser-stream.ts`, `server/drivers/acp/host.ts`, `server/drivers/acp/core.ts`, native/server logging owners and packaged runtime.
- **Change:** first preserve tracker P-05 with redacted, correlated per-turn `session/new` and `session/prompt` latency emission into `server.log` on the serving path; existing native NDJSON timestamps or sampled benchmarks alone do not satisfy it. Add load/resume timing where applicable. Separately record cold/warm startup, idle CPU/RSS, useful progress, event-loop/SSE/cancel lag, history, native concurrency and disk contention; set defensible budgets before changing synchronization/pooling/topology.
- **Done:** a serving-path check confirms required new/prompt timings reach `server.log` for every applicable turn, with correlation and no prompts, keys or protocol-stdout contamination; unavailable/failed stages are distinguishable. Before/after benchmark results separately identify bottlenecks and limits. Source size/catalog/synthetic throughput alone proves no speedup; any justified pooled-Hermes experiment preserves per-session MCP/auth/profile/Stop isolation.

## E — Exact installed product and promotion

### C-20 — Resolve release identities and native-machine prerequisites early

- [ ] **Owner:** authorized release/signing maintainer and native verifiers. **Starts:** parallel with A. **Maps:** R-160-011; spec100-releases.
- **Surfaces:** approved Apple Developer ID/notarization identity, Windows signing/publisher policy, repository Actions permissions, native target machines/accounts, `docs/releasing.md` and `.github/workflows/release.yml`.
- **Change:** verify which required credentials/permissions are actually available without dumping secret values; establish ownership and signing continuity. An inaccessible setting is unverified, not automatically missing. Reserve the exact claimed target matrix and isolated account/fixture resources.
- **Done:** all prerequisites have a verified owner/provisioning result or exact external blocker. No security override, private token distribution or unsigned-public-promotion shortcut substitutes for project signing requirements.

### C-21 — Qualify exact native install, upgrade and candidate update path

- [ ] **Owner:** release maintainer with native verifiers. **Depends for installed closure:** C-04/C-05/C-10/C-12/C-14/C-20. Candidate artifact construction can start earlier and supplies the exact bytes for C-17/C-22 qualification; it does not require their completion or public publication. **Maps:** R-160-011/A-160-11; 080/100 and spec140 R012/013.
- **Files/tools:** `electron-builder.yml`, `electron/updater.mjs`, `.github/workflows/release.yml`, `scripts/release-artifacts.mjs`, `scripts/smoke-packaged-server.mjs`, existing native installer/update/restore recipes.
- **Change:** build one reviewed source candidate on matching targets; validate all feeds/versioned assets/aliases/hash/architecture/blockmaps and actual signature/notarization identity. Exercise clean install, first-run and exact downloaded N→N+1 plus forced failure recovery, settings/provider/vault preservation and documented uninstall residue. Keep browser helper releases non-latest.
- **Done:** existing installed updater can consume the exact candidate through an isolated compatible feed; invalid/missing/tampered/untrusted bytes fail accurately; recovery preserves newer effect receipts and never replays interrupted work. No hidden downgrade or misleading up-to-date result closes a feed error. Public promotion/readback is C-24 after C-22, not a prerequisite for running the installed demo.

### C-22 — Close real-task, native and installed-demo acceptance

- [ ] **Owner:** product verification maintainer; authorized real-provider/native operators. **Depends:** relevant B/C/D behavior and C-21 exact candidate. **Maps:** R-160-007/010/012; A-160-07/10/12; 090 and spec140 AC001–006.
- **Files/tools:** `evals/`, `docs/verification/local-hermes.md`, current controlled workboard/browser receipt scenarios and installed app surfaces. Existing live user workspaces are not verification fixtures.
- **Change:** use the exact selected model/harness/permissions against independently observed targets. Include recoverable reads, concrete remaining-work Chief handoff/readmission, one forbidden-effect sentinel, denial/Stop/revocation and lost-acknowledgement outcomes. Author the actual installed demo/reset/failure runbook.
- **Done:** target receipts/state—not model claims or one prescribed trace—satisfy the original task. At least one authorized live staging verification per provider actually advertised as supported is attached for the exact candidate/route, with tool/image claims qualified as applicable and explicit accounts/budgets; one selected working provider cannot close this matrix. Required installed20-run/two-rehearsal gates and separate physical voice evidence pass where claimed. Failures/skips/unrun gates remain visible; no new judge/framework is needed.

### C-23 — Reconcile operations policies and deferred product decisions

- [ ] **Owner:** product/release maintainer; owner approval for changes in requirement scope. **Depends:** evidence inventory; not a prerequisite for unrelated safe fixes. **Maps:** R-160-010/011/012; spec990 and tracker/issue23 conditional scope.
- **Change:** explicitly settle claim matrix, zero-account/free entitlement promise, app-wide versus workspace secret scope, broader forgetting semantics, proactive rollout and unsupported native capability policy. Reconcile old byte-exact signed-build/canary/remote-kill/telemetry requirements with actual distribution/privacy architecture; original criteria stay open until amended. Keep new hosting/mobile/WhatsApp/domain work, optional Laya and offline speech separately approved/parked.
- **Done:** no unapproved expansion is a base release dependency; no accepted requirement is silently removed. Existing remote clients and security remain preserved. Final release notes classify working, broken, unverified and unavailable capabilities with their evidence and support/recovery owner.

### C-24 — Promote only the qualified desktop release and verify public delivery

- [ ] **Owner:** authorized release maintainer. **Depends:** C-21 exact-artifact qualification, C-22 required task/demo/native evidence, C-23 resolved promotion policies and all advertised capability gates. **Maps:** R-160-011/012; A-160-11/12.
- **Surfaces:** canonical GitHub release/tag, stable aliases, platform feeds, downloaded artifacts and prior installed clients; existing release workflow/validator/updater.
- **Change:** obtain explicit publication authorization, publish the immutable candidate under a newer valid version and keep auxiliary releases non-latest. Do not overwrite an existing public version or claim a source push/draft updates installed users.
- **Done:** anonymous latest identifies the complete verified desktop release; all feeds/referenced bytes/aliases are read back and match the qualified version, hashes and native signature identity. Prior supported clients discover the intended upgrade; incomplete/helper-only latest or lookup failure is actionable. Record rollout/hold/recovery ownership and the actual public result.

## Shared verification rules

Use the current package scripts and [verification entry point](../../docs/verification/README.md), not obsolete copied commands from absent modules. Typical integration commands already exist (`pnpm test:agent-fast`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` and native package/smoke commands); run the relevant focused checks after each integrated slice and the full required candidate matrix before promotion. Do not rerun a known failing check merely to confirm it; diagnose from its retained evidence and run after the relevant fix.

Real-provider qualification, physical devices, installed artifacts and public publication are separate authorization/evidence gates. Narrow fixture/native-constructor passes do not substitute for them. Safe unknown outcomes and honest unavailable modes are correct behavior; they are not grounds to remove the corresponding accepted feature from the remaining backlog.
