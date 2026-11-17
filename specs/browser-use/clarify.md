# Browser use: clarification register

Status: research answered where possible; no human response required to finish this docs-only packet. Default decision while the owner is unavailable: **adopt neither**. Implementation and spending remain unapproved.

## Repository questions

| ID | Question | Evidence-based answer / unresolved boundary |
|---|---|---|
| Q01 | Is the supplied main SHA current? | **[V, fetched]** Yes: `c077c7940be477e50857b106f7e1cf4202babd81`. CI/Release and local failures are recorded in [baseline.md](baseline.md); the report is not green. |
| Q02 | Are there two engines and one turn boundary? | **[V, source]** Default agent-browser, alternate Dani Chrome/CDP. `server/host/browser.ts` mounts the turn-scoped proxy; active generation/profile is rechecked in `server/index.ts`. Native SDK access remains server-owned. Bearer bytes may be reused, so fresh token bytes are not the security invariant. |
| Q03 | Must all turns always have different cookies/tabs? | **[V, source]** No: named shared profiles are deliberate, serialized sharing within an audience; distinct profiles/audiences are isolated. **Recommendation:** test A1 against distinct authorized identities plus explicit sharing as a separate positive case. Removing shared profiles is not approved. |
| Q04 | Does the current browser universally require exact write approval? | **[V, source]** No. Browser dispatch has no universal per-write permit; provider policies vary. **[UNVERIFIED]** Exact-effect classification and enforcement for all arbitrary page actions. **Recommendation:** no candidate write admission until a common enforceable permit exists. Tightening existing-engine behavior needs explicit scope approval, not a hidden change under C6. |
| Q05 | Does cancellation stop an accepted action and all its networking? | **[V, source]** Not guaranteed. Revocation fences dispatch/results; underlying work can continue and become uncertain. Common egress gates are not turn-lived HTTP-write gates. **[UNVERIFIED]** Measured native stop bound and no-late-effect guarantee for new backends. |
| Q06 | Is current redaction/takeover/evidence identical on both engines? | **[V, source]** No blanket parity claim is justified. Text scrubbing, human holds and queued-action invalidation exist; uncertain drain behavior differs. Recorded-step integration and saved-login screenshot secrecy on CDP need dedicated proof. **Recommendation:** withhold unknown captures; do not infer full pixel secrecy from string redaction. |
| Q07 | Is there a real why-now task? | **[V, historical source]** The committed error-flood stall motivates a narrow observability experiment. **[UNVERIFIED]** Current reproduction or candidate remedy. No committed matched browser-task trace was found; personal traces were not inspected. Native synthetic smokes are not a quality benchmark. |
| Q08 | Can evals supply today's comparison? | **[V, executed/source]** Existing evals are mainly synthetic coordination/skill fixtures and currently have seven local failures. No committed browser golden set or run result provides the requested comparison. Exact receipts and formats are in baseline. |

## Stagehand questions

Source identity: npm `@browserbasehq/stagehand@4.4.0`, source commit **`5a5b48acfadf637f2243233745fc5fc277b89b34`**. These are inspected-source facts, not executed SDK evidence.

| ID | Question | Evidence-based answer / unresolved boundary |
|---|---|---|
| Q09 | Are the supplied version/Zod facts current? | **[V, registry]** npm latest is 4.4.0, Node `>=22.18.0`, direct Zod dependency exactly `4.6.6`; the reported 4.3.0 exists with exactly `4.4.3`. Installation docs still recommend `~4.4.3`. Dani main pins Zod `4.6.7`. PyPI is 4.4.0. **[UNVERIFIED]** Cross-copy schema conversion, types and bundled extension assets; do not override/downgrade Dani's Zod. [S1–S4] |
| Q10 | Does September's second-loop rejection still fully apply? | **[V, source/docs]** v4 removed `agent()`. However `observe` uses a model; `extract` normally performs Extraction plus Metadata generations; string `act` can execute two steps and optional self-heal. Failed cache replay can return to inference. **Recommendation:** only deterministic explicit-target primitives are eligible for the first isolated probe; natural-language action/repair is excluded. [S5–S7] |
| Q11 | Can it attach safely to Dani's CDP/profile? | **[V, source]** `localBrowser.connect({cdpUrl})` exists, but discovers/loads an extension and has browser-wide target implications. `browser.close()` sends `Browser.close` even on an attached local browser; `browser.disconnect()` is separate. Dani's local backend uses its own CDP pipe. **[UNVERIFIED]** Live bridge compatibility, profile ownership, extension support, target isolation and detach under failure. **Not run.** No personal/shared production profile may be the probe. [S8–S10] |
| Q12 | Is its domain policy equivalent to Dani's egress? | **[V, source]** No. HTTP(S) domain rules are browser-wide; an empty allowlist is not deny-all, non-HTTP(S) coverage is not established, and extension backend/model/telemetry traffic has an exemption. Dani policy includes destination IP classes, own ports and host-specific rules. **Recommendation:** Dani remains authoritative; any Stagehand policy is a derived secondary restriction, never a separate owner list. **[UNVERIFIED]** All-protocol/redirect/subresource coverage and failure/revocation gaps. [S11–S12] |
| Q13 | Does timeout/close prove stopped work or human priority? | **[V, source]** No universal AbortSignal contract. Some operation timeouts default to zero; deadline expiry can stop waiting without stopping underlying work. **[UNVERIFIED]** Native cancellation/takeover bound and absence of late input/result/network activity. **Not run.** [S7, S10, S13] |
| Q14 | What does local/cloud mean for data? | **[V, source]** Local model-backed operations send page context to a provider; hosted model selection/cache can be service-owned. Managed cache can transmit accessibility trees and request parameters. Deterministic `page.snapshot()` itself makes no inference, but local is not a blanket no-egress guarantee. **[UNVERIFIED]** Complete traffic/retention inventory. Cloud, cache, telemetry sinks and automatic model fallback are excluded from the first probe. [S7, S14] |

## Pomerado questions

Published version inspected: **`0.4.0-canary.626`**, release SHA **`baeb34a9ed353a05fc86a9cb7eb32a78caa6b10d`**. Additional source inspection used HEAD **`e73e676fd9f1346db5f23badaf7629410f7cf3cf`**; do not silently attribute HEAD behavior to the release.

| ID | Question | Evidence-based answer / unresolved boundary |
|---|---|---|
| Q15 | Is local Windows merely undocumented? | **[V, release source]** It is explicitly refused: `Local process-group execution requires macOS or Linux`. Native Windows is **not tested**, but the source prohibition is decisive for present local admission. WSL or hosted fallback is not authorized. [P1–P2] |
| Q16 | Is Node 24.21+ sufficient? | **[V, registry]** Exact range is `>=24.21.0 <25`. This workstation ran main tests on Node26.8.1. **Recommendation:** do not change Dani's runtime to accommodate it; an approved isolated probe would need an exact compatible runtime. No package was installed. [P1] |
| Q17 | When is an OpenAI key needed? | **[V, docs/source]** Default minting/build/review requires it; minting explores and executes examples and can perform real writes. Already minted local execution makes no model request. **[UNVERIFIED]** Other authoring-provider compatibility. **Recommendation:** optional separately authorized BYOK authoring, no key inheritance, no onboarding prompt, no write mint on real accounts. [P3–P5] |
| Q18 | Are deterministic MCP hints sufficient authorization? | **[V, source]** No. The local host trusts generated source/declared effect; it has user-level filesystem/network privileges, no OS sandbox, and does not re-review edits. Outputs lack general secret scrubbing. A read hint cannot enforce no writes. **Recommendation:** immutable typed admission plus enforced network/process/file boundaries, otherwise unavailable. [P2–P5] |
| Q19 | Can it share Dani's profile/connection? | **[V, source]** Served calls use fresh contexts; local CDP attachment is refused because operations can close other tabs/reset site data. It does not establish compatibility with Dani profile ownership. **[UNVERIFIED]** A safe common-owner integration. No production profile import or duplicate session owner is approved. [P4–P5] |
| Q20 | Does self-healing work and preserve approvals? | **[V, source/docs]** Local host explicitly lacks repair. Cloud docs describe repair, publication of changed code and continuation/re-execution, including possibly applied writes. **[UNVERIFIED]** Repair correctness, immutable revision pinning, disable-repair contract and no second model loop. Cloud repair is excluded, not treated as a transparent retry. [P6–P8] |
| Q21 | Are vendor speed/cost/reliability numbers usable? | **[V]** First-party pages make these claims. **[UNVERIFIED]** Matched tasks/models, repeated-run advantage, authoring/repair amortization and applicability to Dani. No such numbers were measured here; none qualifies adoption. [P9–P10] |

## Common unresolved evidence

| ID | Question | Disposition |
|---|---|---|
| Q22 | Which native platforms pass? | **[V, executed]** Only the existing engines' Intel Mac functional checks in baseline. Stagehand/Pomerado: all four requested native platforms **not tested**. Source/platform documentation is not a pass. |
| Q23 | How large are installers after adoption? | **[V, registry]** Stagehand package-only unpacked size4,139,595 bytes; Pomerado7,873,127 bytes. **[UNVERIFIED]** Total dependencies, extension/Chromium/runtime downloads, compression, installer delta, RSS and startup. Current proposal adds0 dependencies/flags; package sizes are not installer deltas. |
| Q24 | Can optional credentials reuse existing storage? | **[V, source]** `electron/main.mjs`, `secure-credentials.mjs`, `workspace-credentials.mjs` provide OS-encrypted workspace credential handling; unavailable is distinct from empty. **[UNVERIFIED]** A Pomerado-specific binding and all-platform behavior. Plan only: extend that boundary after approval, no new plaintext config store or `.env` file. |
| Q25 | Which model, run counts and cost cap govern comparison? | No live comparison has run. The plan pre-registers selection rules, repetitions and a zero-paid-spend default. An immutable run manifest must resolve a genuinely available approved free model and record its identity/settings before any scored run; absence blocks the run, not a silent provider swap. Optional paid minting requires a separate explicit cap. |
| Q26 | Does the later permission waive the go gate? | **[V, owner instruction]** It permits independent worktrees and a PR. It does not say implement or enable. This session may publish the docs-only approval packet; no product changes, merge, release or live paid experiment follows. |
| Q27 | Can the existing red baseline be ignored? | No. Fixes to unrelated packaging/control-plane/iOS/eval infrastructure belong to separately authorized work. This packet preserves observed failures; a later benchmark cannot use a broken runner as performance evidence. |

## Only owner decisions remaining

No terminal action is requested. Until an answer exists, the recommendations below are the operative **no-change** defaults, not implementation permission.

1. **Stop with no adoption, or approve the bounded evidence phase?** Recommended: keep the product unchanged; if further evidence is desired, approve only tasks T02–T07 described in the plan, starting with both existing engines and isolated compatibility probes. No cloud or paid authoring by default.
2. **If a candidate shows benefit, may existing browser write behavior be tightened to an exact common approval contract?** Recommended: yes only through a separately reviewed scope decision; do not claim this is already present or silently alter all existing-provider behavior.
3. **Permit Pomerado paid authoring/cloud?** Recommended: no for this phase. Future BYOK minting needs an owner-selected provider/data scope and explicit monetary cap; cloud repair needs a separate contract/privacy review. Missing permission means omit that candidate, not invent a successful zero-cost mint.

## Primary sources

- [S1] [Stagehand4.4.0 registry](https://registry.npmjs.org/@browserbasehq%2Fstagehand/4.4.0)
- [S2] [Stagehand4.3.0 registry](https://registry.npmjs.org/@browserbasehq%2Fstagehand/4.3.0)
- [S3] [Installation docs](https://docs.stagehand.dev/v4/first-steps/installation.md)
- [S4] [Python4.4.0 registry](https://pypi.org/pypi/stagehand/4.4.0/json)
- [S5] [v4 migration](https://docs.stagehand.dev/v4/migrations/v3.md)
- [S6] [Pinned act service](https://github.com/browserbase/stagehand/blob/5a5b48acfadf637f2243233745fc5fc277b89b34/packages/extension/services/actService.ts)
- [S7] [Pinned extract service](https://github.com/browserbase/stagehand/blob/5a5b48acfadf637f2243233745fc5fc277b89b34/packages/extension/services/extractService.ts), [observe service](https://github.com/browserbase/stagehand/blob/5a5b48acfadf637f2243233745fc5fc277b89b34/packages/extension/services/observeService.ts), [cache service](https://github.com/browserbase/stagehand/blob/5a5b48acfadf637f2243233745fc5fc277b89b34/packages/extension/services/cacheService.ts)
- [S8] [Pinned browser factories](https://github.com/browserbase/stagehand/blob/5a5b48acfadf637f2243233745fc5fc277b89b34/packages/sdk-ts/src/browser/factories.ts)
- [S9] [Pinned CDP client](https://github.com/browserbase/stagehand/blob/5a5b48acfadf637f2243233745fc5fc277b89b34/packages/sdk-ts/src/cdpClient.ts)
- [S10] [Pinned browser close/disconnect](https://github.com/browserbase/stagehand/blob/5a5b48acfadf637f2243233745fc5fc277b89b34/packages/sdk-ts/src/browser/index.ts)
- [S11] [Pinned domain policy](https://github.com/browserbase/stagehand/blob/5a5b48acfadf637f2243233745fc5fc277b89b34/packages/extension/understudy/domainPolicy.ts)
- [S12] [Pinned network rule enforcement](https://github.com/browserbase/stagehand/blob/5a5b48acfadf637f2243233745fc5fc277b89b34/packages/extension/understudy/domainPolicyDnr.ts)
- [S13] [Pinned deadline semantics](https://github.com/browserbase/stagehand/blob/5a5b48acfadf637f2243233745fc5fc277b89b34/packages/extension/understudy/progress.ts)
- [S14] [Model routing docs](https://docs.stagehand.dev/v4/configuration/models.md)
- [P1] [Pomerado release registry](https://registry.npmjs.org/pomerado/0.4.0-canary.626)
- [P2] [Release local process boundary](https://github.com/Pomerado/pomerado/blob/baeb34a9ed353a05fc86a9cb7eb32a78caa6b10d/typescript/src/execution/local-process.ts)
- [P3] [Inspected HEAD README](https://github.com/Pomerado/pomerado/blob/e73e676fd9f1346db5f23badaf7629410f7cf3cf/README.md)
- [P4] [Inspected HEAD lifecycle](https://github.com/Pomerado/pomerado/blob/e73e676fd9f1346db5f23badaf7629410f7cf3cf/docs/how-it-works.md)
- [P5] [Inspected HEAD local runtime](https://github.com/Pomerado/pomerado/blob/e73e676fd9f1346db5f23badaf7629410f7cf3cf/typescript/src/standalone/run-operation.ts), [MCP server](https://github.com/Pomerado/pomerado/blob/e73e676fd9f1346db5f23badaf7629410f7cf3cf/typescript/src/standalone/mcp-server.ts), [session](https://github.com/Pomerado/pomerado/blob/e73e676fd9f1346db5f23badaf7629410f7cf3cf/typescript/src/standalone/session.ts)
- [P6] [Release unsupported hosted features](https://github.com/Pomerado/pomerado/blob/baeb34a9ed353a05fc86a9cb7eb32a78caa6b10d/typescript/src/hosted-features.ts)
- [P7] [Cloud job/repair contract](https://docs.pomerado.ai/guides/jobs/job-object.md)
- [P8] [Cloud run API](https://docs.pomerado.ai/api-reference/runs/run-a-tool.md)
- [P9] [Vendor claims](https://pomerado.ai/)
- [P10] [Founder YC launch](https://www.ycombinator.com/launches/WSd-pomerado-the-faster-cheaper-and-more-reliable-alternative-to-browser-use)
