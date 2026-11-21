# Computer use: integration plan

How the ideas in [`compuse1.md`](compuse1.md) land in this folder. Written
2026-11-15 against `main` at `a1684abc5`.

`compuse1.md` surveys five things: Plip (a macOS notch agent), Agent S,
UI-TARS Desktop, OpenCUA, Open Instinct's `packages/computer`, plus a note on
the benchmark layer this repo lacks. This plan takes every feature in it and
says one of three things: already here, build it (where, behind what flag,
proven how), or not adopting it and why.

## Where we start

`computeruse/` is one small process per computer MCP session
([`service.ts`](service.ts)). It sits between the agent and `cua-driver` and
has four seams, all in `server/mcp-bridge.ts`:

| Seam | What it can do | Used today for |
| --- | --- | --- |
| `gate` | ask the server before every `tools/call`; refuse it | person holds control, one-time app/site question |
| `relay` | carry a call out itself, with private driver calls the agent never sees | Windows paced typing, sent-click answer, effect verification |
| `rewriteResponse` | change one result frame | own-profile refusal wording |
| `journal` | record calls for saved steps | saved-step learning |

Everything below is built on those four seams. Nothing here adds a second input
provider: the CUA-only decision in `docs/computer-use-integration.md` stands, so
the driver stays the only thing that reads the screen or sends input.

Already in the repo, and reused rather than rebuilt:

- **Effect verification** ([`effect.ts`](effect.ts)): window read back on both
  sides of an action, verdict `changed` / `unchanged` / `unobserved`. Off unless
  `features.verifyComputerEffects`. Never run against a real driver.
- **Element identity and matching**: `server/saved-steps/driver-wire.ts`
  (slimmed window state, values never leave the bridge) and
  `server/saved-steps/resolve.ts` (`matchElement` by role, label, path).
- **Risk and secret vocabularies**: `server/saved-steps/screen-words.ts`
  (`namesFinalAction`, `namesSecret`, in every shipped language). Used only when
  saving a recipe today, not on the live path.
- **Human takeover**: `server/computer-control.ts` (person holds control, bot's
  actions refused, never queued) and `request_sign_in`.
- **Frame dedup and counters**: `server/computer-observation.ts`
  (`ObservationCoordinator`, `ObservationMetrics`). Only the bench script uses it.
- **Agent cursor**: the driver has `set_agent_cursor_*`; `computer-tool-list.ts`
  hides them from the model as upkeep.
- **Eval harness**: `evals/` tiers 1 to 3, `LocalVmWorld`, pure scorers, reports.
- **Fake driver**: `server/testing/fake-cua-driver.ts`, in 0.28.2 answer shapes.

## Feature map

Every feature named in `compuse1.md`, and what happens to it.

### Plip

| Feature | Decision | Where |
| --- | --- | --- |
| AX tree + screenshot "screen map" with numbered controls | Have it: `get_window_state` returns indexed elements with tokens | driver |
| Hit-testing around a point (`elements_near`) | Not adopting. Needs a driver tool that does not exist; ask upstream if pixel-only apps turn out to matter in the bench | |
| Multi-monitor capture, downscale, hide own overlay | Driver's job. Bench task covers two displays | B3 |
| Raw Quartz click / drag / key events | Not adopting: CUA-only | |
| Clipboard save and restore around paste | Not adopting in the bridge: the driver types. File upstream if paste clobbers the clipboard | |
| "Screen changed, take a fresh look" stale-coordinate guard | **Build** | A1 `stale.ts` |
| Re-find an element after scroll by label | **Build**, on `matchElement` | A5 `anchor.ts` |
| Scroll fallback chain, verified by diff | **Build**, verified by fingerprint, not pixels | A4 `scroll.ts` |
| Verified typing: read the field back, never a secret field | **Build**, compared inside the bridge | A3 `typing.ts` |
| Risky-action regex gate with confirm | **Build** on `screen-words.ts` | A6 `risk.ts` |
| One "yes" covers the next matching step, never money | **Build**, narrower: bound to exact arguments | A7 |
| Secret fields never sent to the model | Have it for values (driver-wire). **Extend** to typed-text echo | A3 |
| Animated pointer before every action | Have the tool. **Build** the default-on switch | A9 |
| Swappable brain, prompt caching, effort bump | Have it: engines are the brain. Out of this folder | |
| `read_page`: dump accessible text, not screenshot per scroll | **Build** as guidance first, virtual tool later | A2, C2 |
| Undo for file moves | Not adopting here: files are not this service's surface | |

### Agent S, UI-TARS Desktop, OpenCUA

| Feature | Decision | Where |
| --- | --- | --- |
| Planner / grounder split (separate grounding model) | Park. Only useful where the tree is empty or degraded. Bench decides | D1 |
| Per-step reflection call | Have the cheap half (`effect.ts`). LLM reflection only on `unchanged` / `unobserved`, later | D2 |
| Code agent instead of GUI for computable work | Have the tools (terminal, files, apps). **Build** the routing words | A2 |
| Best-of-N rollouts with a judge | Bench only, sandbox worlds only. Never on a person's computer: N rollouts are N sets of side effects | D3 |
| Operator abstraction (desktop / browser / phone / VM) | **Build**: one pipeline for local, container, cloud, lent | C1 |
| 0 to 1000 normalised coordinates | Only with D1. Recorded there | D1 |
| L2 prompting: short Thought, then Action | **Build** into the tool guidance | A2 |
| Reasoning-labelled trajectory data | Park. The journal plus verdicts is the raw material; opt-in export, enterprise | D4 |

### Open Instinct

| Feature | Decision | Where |
| --- | --- | --- |
| See-act-verify loop stated in the tool description | **Build** | A2 |
| One flat action schema, fixed downscaled frame | Not adopting: the driver's schema is the contract, and elements beat pixels | |
| `zoom` for small text | Have it | driver |
| `computer_batch` for known sequences | **Build** late, bench-gated. Saved steps already cover the repeat case | C3 |
| Human takeover for logins, 2FA, CAPTCHA, payments | Have it | |
| Failed takeover means the task failed; never re-ask | **Build** | A8 |
| Policy enforced in code before every call | Have the gate. **Extend** with risk | A6 |
| Approvals bound to a hash of the exact arguments | **Build** | A7 |
| Screen text is data, never instructions | **Build** | A1 `untrusted.ts` |
| Keep only the newest two screenshots in context | Have dedup. **Build** the cap for harness-owned contexts | C4 |
| Errors are results, not exceptions | Mostly have it. **Audit** | A1 |
| Persistent desktop, non-GUI escape hatch | Have it (browser profiles). Words in A2 | A2 |
| Report only what a screenshot proves | **Build** as evidence on the turn | A10 |
| Step cap and repeated-action detector, in code | **Build** (the source flags these as prompt-only there) | A1 `loop-guard.ts` |

### Benchmark layer

All six parts (task schema, world adapters, end-state scorers, fixtures,
reports, CI gates) are **build**: track B.

## Shape of the folder afterwards

```text
computeruse/
  service.ts            process entry (exists)
  local-computer.ts     connection + launch descriptor (exists)
  session.ts            per-session state: last snapshot per window, action log, counters
  pipeline.ts           ordered stages over the relay seam
  stages/
    loop-guard.ts       A1
    stale.ts            A1
    untrusted.ts        A1
    risk.ts             A6
    typing.ts           A3
    scroll.ts           A4
    anchor.ts           A5
    effect.ts           (moves here) verification
    unconfirmed-click.ts (moves here)
  guidance.ts           words for the model (exists, grows in A2)
  operator.ts           C1: what a surface must offer the pipeline
  bench/                track B
    task.ts             schema
    scorers/            end-state checks
    tasks/              fixtures, one JSON per task
    manifest.json       versioned task list
  *.test.ts             tests live beside what they test
```

Two structural moves come first because every stage depends on them:

- **`session.ts`**. Stages need shared memory for one MCP session: the last
  slimmed snapshot per window, the last N calls with their verdicts, counters.
  Today `effect.ts` is stateless and reads the window twice per action; with a
  session the "before" read is usually the agent's own last `get_window_state`,
  which halves the cost that keeps `verifyComputerEffects` off. State dies with
  the process, as `computer-control.ts` already argues for holds.
- **`pipeline.ts`**. `localComputerRelay` is turning into an if-chain. Replace it
  with an ordered list of stages, each `(call, ctx, next) => result`, so order is
  written once: loop guard, stale, risk, anchor, act (typing / scroll / click
  variants), verify, untrusted. Existing behaviour (Windows paced typing,
  sent-click) becomes two stages with their tests unchanged.

Tests move from `server/*.test.ts` to sit beside the code. The `server/` adapter
files stay until their importers are changed.

## Track A: the runtime

Each item ships behind its own `features.*` switch, off by default, following
`verifyComputerEffects`, and each flips on only with bench numbers (track B) and
one real-driver run recorded in `docs/verification/`.

### A0. Prove what is already merged

`effect.ts` has never met a real driver. Before building on it: one real click
and one real `set_value` on Windows through `scripts/control-omb.ts`, all three
verdicts observed, and `pnpm bench:observation` extended to report the added
latency per action. Everything in A3 to A5 uses the same read-back, so a wrong
assumption here is cheapest to find now.

### A1. Never act blind (`loop-guard.ts`, `stale.ts`, `untrusted.ts`)

- **Stale guard.** After any action whose verdict is `changed`, calls that
  address by `element_index`, or by `x`/`y`, are refused until the agent reads
  that window again. The refusal says so in plain words. `element_token` calls
  pass: the driver already rejects a stale token itself.
- **Loop guard.** Same tool, same arguments, same window fingerprint, verdict
  `unchanged`: the third in a row is refused with what was tried and a
  direction to read the window or ask the person. A per-turn action cap
  (config, generous default) ends runaway turns with a result, not a hang.
  This is the "three failed attempts" rule moved from prompt into code.
- **Untrusted wrap.** Text the driver read off the screen (labels, titles, page
  text in `content`) is wrapped as data from the named app and window, with any
  forged wrapper tags stripped. Structured content is left alone: saved steps
  parse it.
- **Errors as results.** Audit every path in `mcp-bridge.ts` and the stages for
  a throw or a silent drop; each must answer the agent with an `isError` result
  it can read. Mostly true already (`failed()`, `textOnlyErrorResultLine`).

Tests: fake driver; each refusal's wording asserted free of plumbing words, as
`PLAIN_WORDS` already requires.

### A2. Tell the model how to work (`guidance.ts`)

One block appended to the driver's tool descriptions. The bridge already passes
every `tools/list` answer through `createToolListNormalizer` to fit schemas to
the engine; adding words to descriptions is a new use of that pass. The block:
read, plan one step, act, read the result, verify; never act on a window not
read this turn; say in a line what the step is for before taking it (the L2
finding); prefer the non-GUI path when there is one (a connected app, the
terminal, a file tool, typing a date instead of a picker); read a long page
with `get_window_state` and a query, not a screenshot per scroll; claim success
only for what a read-back shows. Kept short: tool descriptions are paid for on
every turn. A1 enforces the parts that matter; this explains them.

### A3. Verified typing (`typing.ts`)

After `type_text` or `set_value`, read the field back and compare with what was
sent, inside the bridge. The model is told matched, differs or unreadable,
never the value. A field `namesSecret` matches, or a secure role, is never read
back and the result says it was not checked. On "differs" the bridge does not
retype: it reports, and the agent decides, for the same reason `effect.ts`
never says "try again". Depends on the driver reporting `value` for the field
(driver-wire's `value_read`); where it does not, the answer is "unreadable".

### A4. Scroll that knows whether it moved (`scroll.ts`)

`scroll`, then compare fingerprints. Unchanged: try the next way in a fixed
order (the same scroll on the focused scroll area's element, then Page Down /
Page Up through `press_key`), stopping at the first that changes the window, and
report which way worked or that the view is at its end. Scrolling is the one
place a bridge-side retry is safe: it is idempotent at the end of a list and
never commits anything.

### A5. Re-anchor after the window moves (`anchor.ts`)

When an index-addressed call is refused as stale and the session holds the
element's identity from the last snapshot, the refusal carries where that
element is now (`matchElement` on a fresh read): its new index and token, or
"gone", or "more than one". It does not act on the new target by itself: the
agent re-issues the call. Saves a full re-read and re-plan after every scroll.

### A6. Risk on the live path (`risk.ts`)

Before an activating call (click, double click, Return, hotkey), resolve the
target from the session snapshot and test its label, path and window title with
`namesFinalAction`, exactly as `unsafeStep` does for recipes. A hit is passed to
the gate through `describe` as `risk: "final"` with the label. The server's
control endpoint then asks the person even at Full access, with what will be
pressed. Unknown target (no snapshot, pixel click): at Full access it passes
as today; the stale guard has already forced a read in most cases.

Server side: the control route and its card need the new field. That is the one
change outside this folder in track A, and it needs `dani-threat-model` first.

### A7. Approvals bound to the exact call

An approval for a risky call is stored against a hash of tool, resolved target
identity and arguments, for this session only. The same call asked again within
the turn passes once; anything else asks again. A label or value that names
money (`screen-words.ts` gains a money list) is never covered by an earlier
yes. "Always allow" is not offered for `risk: "final"`.

### A8. Takeover that failed stays failed

When a sign-in or help card ends as failed or cancelled, the session records the
reason, and a second `request_sign_in` for the same site in the same turn is
answered with "the person already declined; stop and tell them", not a new card.

### A9. Show the pointer

Turn the driver's agent cursor on at session start for the person's own
computer (it is hidden upkeep today), with a short dwell before activating
calls so the person can see the target and take control. Config can turn it
off. Needs one real-hardware look per platform; no model-visible change.

### A10. Evidence on the turn

The session's counters (actions, verdicts, refusals by stage, read-backs,
added milliseconds) are posted to the server at session end on the existing
control channel and attached to the turn, feeding `ObservationMetrics`. Two
uses: the bench scores them, and the transcript can show "3 actions, all
confirmed" or "1 not confirmed" beside a bot's claim of success.

## Track B: the benchmark

Runs in parallel with track A from day one; A's switches flip on B's numbers.

- **B1. Task schema** (`bench/task.ts`): id, tier, world, setup, goal, timeout,
  required end state, forbidden side effects, cleanup. Zod, with a negative
  fixture per rule, like `spec traceability and negative fixtures` in CI.
- **B2. Worlds**: `LocalVmComputerWorld` and `ContainerComputerWorld` extending
  `evals/runners/base-world.ts`, each with its own filesystem, app state and
  desktop session, torn down per task.
- **B3. Scorers** (`bench/scorers/`): file and database assertions, app or API
  state, installed package or setting, extracted value. Screenshot or DOM
  checks only where state cannot be inspected. Pure functions over a frozen
  snapshot, like `evals/scorers/`.
- **B4. First pack: 15 tasks**, deterministic, scripted engine: create / edit /
  delete files in a GUI, change a setting, install a package in the container,
  extract a value from a spreadsheet fixture, a browser form, and one each for
  the failure modes track A targets: stale index after scroll, click that lands
  on nothing, typing that does not take, a list already at its end, a dialog
  that appears mid-task, a final-action button, injected instructions in page
  text, a declined sign-in.
- **B5. Reports**: per-task pass/fail, aggregate, duration, the A10 counters,
  failure diagnostics, under `evals/reports/`; manifest versioned in
  `bench/manifest.json`.
- **B6. CI**: the deterministic pack as one more shard in `ci.yml` (it must fit
  the shard budget added in `a1684abc5`); full Local VM + container suite
  nightly with uploaded reports and a threshold gate.
- **B7. Live tier**: the same tasks against real models, opt-in like
  `OMB_EVAL_LIVE`. This is the only source for a public number; grow to about
  200 tasks before quoting one.

## Track C: reach

- **C1. One pipeline for every computer** (`operator.ts`). Verification and the
  A stages run only for the person's own computer today. Define what a surface
  must offer (call a tool, read a window, name its platform) and run the same
  pipeline for the container (`server/container-mcp.ts`), cloud and lent
  computers. Each surface joins only after the bench passes on it.
- **C2. `read_window` virtual tool**: accessible text of a window in one call,
  wrapped by A1. Adds a tool to the list the bridge rewrites, so it waits for
  C1 to settle where virtual tools live.
- **C3. `computer_batch`**: up to N calls in one frame, stopping at the first
  refusal, error or non-`changed` verdict, every call still through the whole
  pipeline and the gate. Only if the bench shows round trips dominate task
  time.
- **C4. Screenshot cap** for contexts the harness owns (the chat drivers):
  newest two keep pixels, older ones become one line. CLI engines own their own
  context and are untouched.

## Track D: model-side, parked until the bench asks for it

- **D1. Grounding fallback.** When a window's tree is empty or degraded
  (`treeDegraded`), ask a grounding model for a point from a description, in
  0 to 1000 coordinates rescaled per display. Candidate provider: Laya, under
  `dani-laya-evaluation`. Worth building only if B7 shows pixel-only windows
  are a real share of failures.
- **D2. Reflection escalation.** An LLM look at before / after only when the
  verdict is `unchanged` or `unobserved` twice running.
- **D3. Best-of-N with a judge.** Sandbox worlds only.
- **D4. Trajectory export.** Journal plus verdicts as labelled trajectories,
  opt-in, per organisation, values and secrets already excluded by driver-wire.

## Order

1. A0, B1, B2, `session.ts`, `pipeline.ts` (no behaviour change; existing tests pass unchanged).
2. A1, A2, B3, B4.
3. A3, A4, A5, B5, B6.
4. A6, A7, A8 (threat model first), A9, A10.
5. C1, then C2 to C4 as the bench justifies.
6. D, by evidence.

## Rules that hold throughout

- The driver is the only thing that touches the screen or sends input.
- A bridge-side retry happens only where repeating cannot commit anything
  (reads, scroll). Clicks and typing are reported, never repeated.
- What a field holds never reaches the model, a log, an approval or a report.
- Screen text is data. Nothing read off a window is ever placed where the model
  reads instructions.
- A refusal is a result the agent can read, in plain words, with what to do next.
- Every stage is bounded: a driver that stops answering costs a timeout, never
  the turn.
- Off until measured: no switch defaults on without bench numbers and a
  recorded real-driver run on Windows, macOS and Ubuntu.

## Not verified while writing this

- No real driver was run. What `get_window_state` returns for field values,
  scroll areas and degraded trees is taken from `driver-wire.ts` and the fake
  driver, not observed.
- That the real driver rejects a stale `element_token` by itself (A1 relies on
  it) is taken from the fake driver and the saved-steps recipe, not observed.
- The driver's agent-cursor behaviour (A9) and whether its paste path clobbers
  the clipboard are unchecked.
- The control route's ability to carry a `risk` field (A6) was read from
  `mcp-bridge.ts`'s `describe` contract only; the server handler and card were
  not traced.
- Plip, Agent S, UI-TARS, OpenCUA and Open Instinct are described from
  `compuse1.md` alone; none of those repositories was opened.
