# 160 — Desktop completion and evidence reconciliation

Status: PROPOSED implementation contract. Research requested 2026-11-13; no application implementation or release is authorized by this packet. Start with [the execution plan](plan.md); use [the pending-work ledger](traceability.md) to distinguish existing code, missing implementation and missing proof.

## Outcome

A new user installs Dani Desktop, reaches honest runtime/model/task readiness, gives an explicitly authorized task to the selected Hermes/provider, sees durable progress and approval state, and receives a result verified against the target. Stop, restart, reconnect and upgrade preserve identity and authority without blindly repeating consequential effects.

This packet reconciles the current working tree with [tracker #21](https://github.com/Dan-Labs-Agi/dani-desktop/issues/21), the older specifications and current specs 120/130/140. It does not revive an absent historical kernel or treat issue closure as current acceptance. Proposed additions in [issue #23](https://github.com/Dan-Labs-Agi/dani-desktop/issues/23) retain their review/decision gates. Number 150 was proposed there for a different scope; this packet uses 160 to avoid that collision.

## Baseline and scope

Baseline: branch `fix/dani-onboarding-updates-compact-sidebar`, HEAD `3a7797656f`, with 187 pre-existing unstaged and 33 untracked files at investigation start. The earlier [architecture assessment](../../docs/audit/dani-desktop-architecture-2026-11-13.md) maps the current owners; the [traceability ledger](traceability.md) records new evidence and contradictions.

Preserve Electron/React, the local Node harness, Hermes ACP, the existing assignment runtime, browser/desktop resource arbitration, message identity, provider choice, local data, memory, connected apps and current native capability limits. Scheduling definitions, goal cards, transcripts and derived diagnostics may retain distinct storage; execution/recovery authority must be consistent.

No existing requirement is silently marked complete or dropped. In particular, signed public promotion, the 20-run installed demo gate, physical voice qualification, and explicitly deferred features retain their original status until their evidence or an approved requirement amendment exists. An internal text-only qualification milestone is not completion of the entire product vision.

## Requirements

| ID | Required outcome | Existing requirements covered |
| --- | --- | --- |
| R-160-001 | Every accepted direct, solo-goal, room and scheduled execution has stable original-request/assignment identity, a durable lifecycle and consistent card/job/CLI projections. Schedule timing remains distinct from execution ownership. | RC-001/002/004/008; 030 R1/R6; R-140-001/015 |
| R-160-002 | Consequential automatic operations persist admitted intent and immutable attempt identity before dispatch; bind scope, resource, generation and approval; record a target receipt, observed non-application or explicit unknown. Recovery reconciles before retry. A local key alone does not make a remote write idempotent. | RC-003/006/009/010/013; 030 R2/R3/R4/R6; R-140-004/008 |
| R-160-003 | Stop/revocation fences queued admission and new effects immediately, preserves uncertainty about already-submitted effects, and cancels the exact agent/native owner. Replacement waits for adequate termination/retirement proof; unrelated processes and sessions remain intact. | RC-005/011/012; HA-012/013; R-BROWSER-003/004; R-CONT-005/008 |
| R-160-004 | Renderer, desktop owner, CLI/headless owner, service worker, remote device and restricted agent have explicit separate authority. Internal capabilities are rechecked at dispatch. Restricted modes cannot gain unattended high-impact access through another native route. Executable probes use discovered adapters or canonical custom executables explicitly selected by the owner, never an unrestricted caller-supplied path. Trusted native execution is identified honestly rather than called a sandbox. | 010 R1–R7; HA-004/010; R-BROWSER-001/002 |
| R-160-005 | Runtime availability, provider authentication, model eligibility, tool/image compatibility and task readiness are separate observations with freshness and actionable failure. Every metered/unknown-billing ingress, including ordinary tasks and Live session creation, requires explicit acknowledgement bound to the actual provider/model before spend. Selected provider/model/protocol is preserved; no unapproved paid fallback, credential borrowing or client-only free-route workaround. | 040 R1–R8; 070 R3/R5/R6; HA-005/007/009/011; R-140-010/014/016 |
| R-160-006 | A clean supported installation can prepare the pinned licensed agent/interpreter/dependencies and reach the promised first-turn state without relying on the developer's existing home/PATH. Repair/update during work is coordinated, retains verified state and cannot create overlapping owners or duplicate effects. | 080 R1–R6; 110 R-BOOT-001/002 and R-RUNTIME-001–004; tracker P-03/P-07 |
| R-160-007 | Task success uses fresh, attributable target evidence and completion criteria. Continuation and authorized supervision preserve the original goal and budgets; denial, genuine human prerequisites and unknown effects remain blocked. A provider response boundary, private completion marker or successful tool count alone cannot certify a consequential task. | RC-008/013; 030 R4; R-CONT-001–008; R-140-001–007/011/015 |
| R-160-008 | Renderer hydration/reconnect has bounded request and buffering lifetimes, isolates optional loads, reconciles accepted sends and cannot replay effects. Workspace changes fence stale requests and projections. | 020 R5; R-140-007; current HTTP/SSE interface |
| R-160-009 | Secret classes have explicit storage/retention/access rules; production storage meets the stated backend strength. Vault unavailability cannot overwrite recoverable ciphertext or claim false success. Memory is scoped, derived, correctable/deletable context, never permission. Local profile work is independent of remote telemetry; analytics requires recorded consent and cannot block local use. | 010 R5/R6; 030 memory/permission criterion; 110 R-PRIV-001; constitution §6/9 |
| R-160-010 | Advertised voice, dictation, computer use, proactivity and remote features have the required native/privacy evidence on their claimed targets. Failed or unqualified modes remain visibly unavailable; accepted feature commitments remain pending, not erased. | 050/060/080 R4; 120 native limits; 990 parked scope |
| R-160-011 | The exact promoted artifacts have complete updater-compatible feeds, provenance and signing required by project policy; fresh install, upgrade, supported recovery and data/provider/vault preservation are exercised natively. Auxiliary releases do not replace desktop latest. | 100-releases R1–R5; 080 upgrade/uninstall; R-140-012/013 |
| R-160-012 | One current status ledger names serving owners, candidate/source/runtime identities, evidence tier, failed/unrun gates and external prerequisites. Current candidate CI and relevant packaged/real/native scenarios—not old checkmarks—govern promotion. Measure resource/latency budgets before optimizing process/storage topology. | 020 inventory/reachability; 090; 100 provenance/ops; tracker #21 |

## Given / When / Then acceptance

These are required future outcomes, not passes produced by authoring this plan.

| Gate | Given | When | Then |
| --- | --- | --- | --- |
| A-160-01 | Direct chat, explicit solo goal, room and routine requests | Each is accepted, observed, stopped and recovered | Original request and durable assignment are correlated; card/job/CLI states agree, including after restart. |
| A-160-02 | One admitted consequential operation and a target with a receipt or inspection interface | The owner dies before dispatch, after target commit/before receipt, or after receipt/before response | Target state proves one intended effect or explicit unresolved execution; no blind repeat. A target without sufficient evidence stays unknown. |
| A-160-03 | A queued, permission-waiting, tool-running or disconnecting task | Stop/revocation arrives and a late callback follows | No newly authorized effect or stale revival; exact child retirement is proven or replacement remains blocked; unrelated work survives. |
| A-160-04 | Wrong-origin renderer, unpaired/revoked device, service shell, wrong generation, restricted native tool or unselected executable path | It attempts an unauthorized read, approval, dispatch, worker impersonation or executable probe | The applicable authority and executable-selection contracts refuse it; sensitive output and unrelated sessions remain inaccessible. |
| A-160-05 | Engine present but provider/model/tool support absent, stale, mismatched or revoked, or required paid-use consent missing | Setup/doctor/picker/send report state, or a task/Live session attempts provider access | No false task-ready label, silent substitution or unconsented metered provider request; the user gets the correct prerequisite. A qualified route consumes an unpredictable tool result exactly once. |
| A-160-06 | Clean machine and later an active owned turn | Install/repair/update runs or fails partway | Pinned payload/protocol is verified, old verified state is recoverable, app remains usable in limited mode, and work is neither lost nor duplicated. |
| A-160-07 | An original multi-step task with one recoverable read failure and a bounded incomplete worker | The selected real Hermes/model performs or delegates it | Authorized remaining work continues, independent target evidence satisfies the task, and genuine prerequisites/denial/unknown effects are not reported as completion. |
| A-160-08 | A never-settling optional snapshot request, stream gap, lost send response or workspace cutover | The UI reconnects/rehydrates | Usable chat recovery is bounded; accepted sends reconcile; stale frames cannot affect the new workspace; browser input is not replayed. |
| A-160-09 | Existing secrets/memory, unavailable/locked/weak storage, changed audience or absent telemetry consent | Save, unlock, migrate, forget, restore, switch workspace or initialize analytics occurs | Storage/access/privacy rules hold; no destructive fallback, false vault label or unconsented analytics initialization/network call; retained memory cannot grant authority. |
| A-160-10 | A claimed native voice/computer/proactive mode | It executes on the named real device, including denial/interrupt/offline cases | Native evidence and truthful capability labels match. Voice retains spec050's physical soak criterion; unqualified modes do not masquerade as working. |
| A-160-11 | A signed release candidate and prior supported installation | The exact downloaded N→N+1 update and a forced failure/recovery run | Feeds/bytes/signature identity match, data/provider/vault state survives, interrupted effects reconcile, and publication does not expose a helper-only latest release. |
| A-160-12 | A candidate proposed for completion/promotion | All mapped gates and evidence are reviewed | Current required CI completes; installed demo/native gates pass where claimed; failures/skips/unrun evidence and approved limitations are explicit. No result from another SHA/platform is substituted. |

## Privacy and performance

Use disposable homes/accounts/targets for mutation checks; authorize any real-provider probe and its actual budget separately. Logs/evidence retain correlation and target receipts without keys, private prompts, raw credential arguments or unnecessary personal data. Remote telemetry and account features retain consent and local-first boundaries.

Performance baseline is pending measurement, not a fabricated target: cold/warm startup, idle CPU/RSS, first useful progress, event-loop/SSE/cancel lag, realistic long-history hydration, concurrent native sessions and disk contention. Reuse existing desktop/persistence/browser benchmarks. A process-crash test is not a power-loss durability test; define persistence guarantees per record and use stronger synchronization only where its safety requirement warrants it.

## Non-goals and deferred decisions

This packet does not select a replacement desktop framework, agent framework, browser engine, database or general scheduler. It does not grant unrestricted native tools, introduce silent provider fallback, install a new global Hermes/Python, publish a release, enable Laya, or authorize cloud/WhatsApp/mobile/domain expansion.

Accepted base-product requirements and separately approved full-vision work remain in [traceability.md](traceability.md). Proposed changes to old word-ban/line-count criteria, exact signed-build reproducibility, rollout/remote-operations policies, free-route promise or parked scope require an explicit requirement amendment; authoring this packet does not approve them.

## Review gate

Before implementation: review [the design and phase dependencies](plan.md), [bounded tasks](tasks.md), and the requirement/evidence mapping in [traceability.md](traceability.md). Each vertical slice needs spec-compliance, security, performance and maintainability review, behavioral failure-before/pass-after evidence where applicable, a serving-path smoke and relevant packaged/native qualification. The final candidate retains the existing full-suite, installed-artifact and release gates.
