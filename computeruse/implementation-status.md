# Computer-use implementation status

This tracks the build items in [plan.md](plan.md). **Implemented** means code and isolated tests exist; it does not mean the feature is enabled by default or qualified on a real driver. Every runtime switch is off by default, and none should default on before a recorded run on a real driver for the platform.

## Completed in code

| Item | Feature | Current implementation |
| --- | --- | --- |
| Foundation | Per-session state and ordered relay pipeline | `session.ts` and `pipeline.ts`; each stage decides per call whether it applies, so a new stage does not grow a condition list. |
| A1 | Stale-target and repeated-action guards | A changed window blocks stale index/point actions until a fresh read; identical unchanged actions and excessive actions are refused. |
| A1 | Untrusted screen-result wrapper | Marks screen text as data and removes field values and forged wrapper tags from window results. |
| A1 | Error-path audit | A relay that threw before returning a promise left the agent's call unanswered forever (`send()` rejected, `forward()` swallowed it). The bridge now answers it with a readable error, with a test that hangs without the fix. The four copies of "read the window with a deadline" are one bounded read (`read.ts`). |
| A2 | Computer-use guidance | The optional tool-description text tells the model to read, act once, and verify. |
| A3 | Verified typing | Reads the field back and reports matched, different, unreadable, or sensitive-field-not-checked, without echoing typed text. |
| A4 | Verified scrolling | Checks for movement; after an unchanged scroll tries a focused scroll area, then a page key. |
| A5 | Stale-target re-anchoring | A stale refusal suggests a fresh index and token when one target matches; it never acts on it. |
| A6 | Final-action confirmation | `confirmComputerFinalActions`. The bridge adds the tool, a fingerprint of the exact call and a cleaned label to its existing control check; the server's broker (`server/final-action-consent.ts`) asks the person on a card with only Allow once or Deny. Same rule as saved steps decides what is final, so the live path and the recipe path cannot disagree. Unidentifiable targets in a window that shows or may show a final action are asked about. |
| A7 | Exact-call approvals | An approval is bound to the fingerprint (target identity, not the element index), one turn, single use, five minutes. A refusal holds for the turn. A call that waited through the answer is told to call again, so an approval is never spent on a call that is then discarded as late. Money needs no special case: nothing is ever covered by an earlier yes. "Always allow" is never offered. |
| A8 | Declined sign-in stays declined | `holdDeclinedSignIn`. A second request to sign in to a site the person cancelled, since they last wrote, is refused with "do not ask again". |
| A9 | Visible pointer | `showComputerPointer`. Uses the driver's own `set_agent_cursor_enabled` and `set_agent_cursor_motion` once per session; no bridge-side sleep. |
| A10 | Turn evidence | `reportComputerEvidence`. Counters are posted as actions finish (the service may or may not outlive its turn) and one plain line is written when the turn releases the computer. The server treats the body as untrusted and writes the sentence itself from clamped numbers. |
| B1 | Task schema | `bench/task.ts`, with a `fixture` world, intents, and a scripted person. |
| B2 | Fixture world | `bench/world.ts` and `bench/desktop.ts`: the real service and pipeline against a data-driven fake desktop (windows, scrolling lists, files, settings, swallowed clicks, dropped typing), with the real final-action consent as the broker. |
| B3 | Inspectable-state scorers | Pure file, database, setting, API, package, and extracted-value scorers. |
| B4 | Task pack | 16 deterministic tasks in `bench/tasks/`, 7 of which need the checks. |
| B5 | Executed reports | `pnpm bench:computer` runs both profiles, writes `evals/reports/computer/`, and gates the run. |
| B6 | CI | `.github/workflows/computer-bench.yml`: one platform on pull requests that touch this code, all three nightly, reports kept even on failure. |

Last run: baseline 9 of 16, checked 16 of 16, gate ok. Each of the 7 tasks that need the checks fails when only its own check is removed (`bench/ablation.test.ts`).

## Not done, and why

| Item | Feature | Why |
| --- | --- | --- |
| A0 | Real-driver baseline | Needs a real click and `set_value` against a disposable Windows window. Driving a real desktop is not something to do unattended on a person's machine. Nothing here has met a real driver. |
| B2 | Local VM and container worlds | Need a container runtime. The fixture world is the first world; the schema and runner take others. |
| B3 | Screenshot or DOM scoring | Only for end states that cannot be inspected; none of the 16 needs it. |
| B7 | Live-model tier | Needs real models and spend. No number from this benchmark may be quoted as a model's success rate. |
| C1 | Other surfaces on the pipeline | The pipeline already depends only on `ChildCalls` (a call and a driver version), which is the surface contract. Container, cloud and lent computers should join one at a time, each after the pack passes on it; none has been run. |
| C2 | `read_window` | Plan said after C1. A relayed answer is not journalled, so any turn that used it could never save a recipe; that cost wants a decision first. |
| C3 | `computer_batch` | Only if round trips dominate task time. Nothing here measures that. |
| C4 | Screenshot cap | Not applicable. The chat driver passes tool results to the model as text; engines that carry screenshots own their own context. |
| D1–D4 | Model-side experiments | Parked by the plan pending live-benchmark evidence. |

## What building this turned up

- **A silent drop in the bridge**, described above. Fixed.
- **Effect verification called working typing "unchanged".** The fingerprint leaves out field contents on purpose, so after a good `type_text` the bot was told the action "may have landed on nothing", and for `type_text`, which appends, a retry types the text twice. Typing is now excluded from effect verification and checked by reading the field. Found by the benchmark; the unit tests had never typed.
- **Effect verification is blind to effects the window does not show.** A click that saves a file, changes a setting, or opens a different window reads "unchanged". In 5 of the 9 fixture tasks that pass with or without the checks, the checked profile made one extra click for this reason. Those clicks were idempotent; a non-idempotent one would be doubled. The scripted agent retries on the note without the nuance in its wording ("only do this again if the window shows the work still has to be done"), so this probably overstates the harm, but it is a reason to keep the switch off until a real model's behaviour on it is seen.
- **The effect check alone rescued the stale-index task.** After a click lands on the wrong row the window "did not change", so the bot re-reads and clicks the right row: the right outcome, after the wrong click. The stale guard's value is preventing that wrong click, so the task now treats a wrong-row click as a forbidden effect and the ablation fails without the guard.
- **`wrapComputerScreenData` removes every field value.** Any task that needs a field's contents cannot be done with it on; the pack reads static text labels for that reason.
- **Failures already on this branch's base**, none touched: `server/index.test.ts` "parks the turn at the wait ceiling…", "asks the person to sign in with one card…" and "brings a sign-in started in a browser…" fail on the commit this work started from; five tests in `scripts/ci-workflow.test.ts` assert a `ci.yml` shape that predates the sharding change.

## Verification

Isolated and fixture-driven only. The computer-use suites, the final-action and evidence server modules, and the benchmark pass; `tsc -p tsconfig.server.json` and `oxlint --deny-warnings` are clean. No real driver, no live app, and none of the user's data was used.
