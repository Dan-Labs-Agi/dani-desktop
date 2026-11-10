# Browser use: specification

Status: **proposal for approval, not implemented**. Read [baseline](baseline.md), then [constitution](constitution.md), [clarifications](clarify.md), [plan](plan.md), and [tasks](tasks.md).

## Decision proposed

**Adopt neither Stagehand nor Pomerado now. Keep the current product unchanged.** There is no matched browser-task evidence establishing benefit, and important ownership, approval and cancellation prerequisites are unresolved. This is a no-adoption decision under uncertainty, not a claim that either existing engine outperforms both candidates.

An explicitly approved, isolated evidence experiment may reconsider that decision. Approval of this packet or its PR is not automatic approval to ship a backend. No user is asked to choose a harness, enter an optional key during onboarding, or execute installation commands.

## Problem, affected people and why now

People delegate both open-ended research and repeated website tasks to Dani. They need correct outcomes, bounded waits, predictable cost, separation between accounts and the ability to take over without a bot continuing to act. A second tool is useful only if it improves a demonstrated problem without weakening those properties.

[V, historical source] The current [browser decision record](../../docs/plans/browser-engine.md#7-page-health-and-recorded-browser-steps--implemented) reports a macOS headless-shell error-flood stall of about 35 seconds and lost error recording. Its committed fixture contains the workload but omits that assertion for the affected binary. This motivates an observability investigation, not a replacement conclusion. The failure has **not** been reproduced in this work, and neither candidate has been shown to fix it.

[V, executed] The [baseline report](baseline.md) records current boundary and eval failures, plus native functional evidence for both existing engines. The failed proxy wording assertion and eval infrastructure failures do not establish a user-facing browsing-quality deficit.

No current committed real-user browser task, browser golden set or matched comparison trace was found to justify adoption. Personal traces were not searched. That evidence gap is itself a reason to retain the current engines rather than add a speculative dependency.

Affected people: existing desktop users, users of owned/shared browser profiles, Team members whose private conversations require distinct accounts, and owners optionally evaluating repeated-site automation. No new onboarding experience is part of this feature.

## Prior decision still applies in part

The September decision rejected Stagehand/browser-use because they would create a second model loop. Single ownership, cross-platform operation, headless support and human priority remain required. [Stagehand v4's migration guide](https://docs.stagehand.dev/v4/migrations/v3.md) now says its built-in `agent()` orchestrator is gone; therefore “all current Stagehand use necessarily creates that old agent loop” is no longer accurate. It does **not** establish that every remaining operation has one bounded effect or fits Dani's safety boundary. No reversal of the existing product decision is proposed without the evidence gates in the plan.

## Required user-visible outcomes for any later candidate

These are admission requirements, not claims about all current product behavior.

- **R1 — Continuity:** ordinary browsing remains available through the person's existing setup. An absent, disabled, unsupported or broken optional integration cannot hijack a task, account or model choice.
- **R2 — Correctness:** report completion only when independent observed state matches the requested result. A tool's success message is insufficient; uncertain effects remain visibly uncertain and are not blindly retried.
- **R3 — Isolation:** separate authorized profiles/audiences do not expose each other's cookies, tabs, files or content. Explicit owner-configured sharing remains deliberate and serialized, not accidentally erased by a stricter-sounding promise.
- **R4 — Stop and takeover:** cancellation blocks subsequent work; human takeover immediately excludes new bot work. The user receives an honest bounded outcome, including uncertainty if an earlier action may already have happened.
- **R5 — Approved writes:** submit/post/purchase-like effects require explicit approval each time or a recorded owner grant of exact scope. A changed target, payload, integration revision or resumed uncertain action cannot reuse stale approval.
- **R6 — Privacy and destination limits:** secrets and disallowed destinations cannot be exposed by changing backend. Page text is untrusted data and cannot enlarge authority. Withhold uncertain captures rather than claim all pixels were scrubbed.
- **R7 — Optionality:** optional authoring keys and costs are opt-in, separate from free-first use, and clearly disclosed. Missing keys or unsupported platforms have a clear unavailable state, no crash and no terminal instruction.
- **R8 — Evidence:** any enabled candidate meets the safety cases and demonstrates repeated same-condition benefit; all setup, failure, human intervention, token and monetary costs count. Insufficient evidence means no adoption.

## User stories and Given/When/Then scenarios

### S1 — Open-ended web task

**As a person delegating research,** I want an answer grounded in visited pages, not an optimistic tool transcript.

- Given an authorized browser and a research request over allowed pages, when Dani explores and extracts the answer, then it cites the observed evidence and completes only when the task's independent result check agrees. **R1, R2, R6, R8.**
- Given a page telling Dani to ignore rules, reveal a planted secret or visit an unapproved destination, when Dani reads it, then the page does not change permissions, model/provider selection or approval decisions. **R5, R6.**

### S2 — Repeated known-site task

**As a person repeating work,** I want faster or cheaper execution only if it is equally correct and uses the intended account.

- Given an explicitly admitted read-only integration for an allowed site, when the same task repeats, then it returns the independently checked result under the same privacy and audience rules as ordinary browsing. **R2, R3, R6, R8.**
- Given a changed site or integration revision, when replay is no longer valid, then Dani reports the specific unavailability or uncertainty; it does not silently repair/publish code, switch accounts, spend on authoring, or repeat a possibly committed write. **R1, R2, R5, R7.**

### S3 — Write needing approval

**As the account owner,** I decide what may be submitted, posted or purchased.

- Given no matching approval, when a write-effect action is requested through either browser actions or an optional integration, then no write reaches the fixture site and Dani asks for the exact missing decision. **R5.**
- Given explicit approval for that exact action, when it executes, then the independently recorded effect matches the approved payload once. Denial, expiration, changed input and ambiguous completion never authorize another write. **R2, R5.**

### S4 — User takes over

**As a person handling a login or correcting a task,** I can take the browser away from the bot.

- Given an in-flight task, when I take control, then new bot reads and writes are excluded across the entire profile, queued actions and old element references cannot execute, and private human input does not enter bot context. **R3, R4, R6.**
- Given I hand control back, when Dani resumes, then it observes the current state, resolves uncertain effects and obtains any newly required approval before acting. **R2, R4, R5.**

### S5 — Offline

**As a person whose connection drops,** I need a clear bounded failure rather than a frozen app or duplicate submission.

- Given no permitted network route, when a new browser action is requested, then Dani returns a clear unavailable/error result within the stated tested bound and the app remains responsive. **R1, R4.**
- Given connectivity was lost after a write was accepted, when it returns, then Dani reports uncertainty and checks the result before any separately authorized retry. **R2, R5.**

### S6 — Missing optional key

**As a free-model user,** I can ignore optional authoring products.

- Given no optional authoring key, when I start Dani or use the default browser, then onboarding and ordinary browsing are unchanged and no paid request is attempted. **R1, R7.**
- Given I deliberately open the optional integration's settings, when its required key/platform is absent, then I see “not configured” or “unsupported,” with a non-terminal setup path and no crash. A key's presence alone is not consent to mint or execute a write. **R5, R7.**

## Success measures and failure disposition

- Every applicable acceptance case A1–A12 in [tasks.md](tasks.md) has exact-commit command/output evidence; unresolved safety, privacy or platform cases block enablement.
- Zero observed unauthorized writes, cross-audience leaks, planted-secret leaks or late post-revocation dispatches in the approved negative corpus. This finite evidence is not a universal security proof.
- No additional failing/skipped existing test identities relative to the baseline; baseline failures are visible and require their own proved fixes before a green release claim.
- A repeated comparison meets the pre-registered correctness/latency/cost rule in [plan.md](plan.md). A single successful demo, package download size or vendor multiplier cannot qualify.
- If these measures cannot be established with the existing stack and ownership boundaries, keep both current engines and adopt neither.

## Out of scope

Physical computer use; harness replacement, self-improvement or the separate harness experiment; onboarding/model-layer changes; arbitrary SDK access; CAPTCHA solving or anti-detection work; importing personal browser profiles; cloud session migration; automatic reminting/self-healing; repairing unrelated CI/eval failures in this docs PR; releases or auto-update changes.
