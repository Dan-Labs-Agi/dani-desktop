# Computer-use implementation status

This tracks the build items in [plan.md](plan.md). **Implemented** means code and isolated tests exist; it does not mean the feature is enabled by default or qualified on a real driver. All new runtime switches remain off by default.

## Completed in code

| Item | Feature | Current implementation |
| --- | --- | --- |
| Foundation | Per-session state and ordered relay pipeline | `session.ts` and `pipeline.ts` keep window observations and order local relay stages. |
| A1 | Stale-target and repeated-action guards | A changed window blocks stale index/point actions until a fresh read; identical unchanged actions and excessive actions are refused. |
| A1 | Untrusted screen-result wrapper | The optional wrapper marks screen text as data and removes field values and forged wrapper tags from window results. |
| A2 | Computer-use guidance | The optional tool-description text tells the model to read, act once, and verify. |
| A3 | Verified typing | An optional field read-back reports matched, different, unreadable, or sensitive-field-not-checked without echoing typed text. |
| A4 | Verified scrolling | An optional stage checks for movement and tries a focused scroll area, then a page key, after an unchanged scroll. |
| A5 | Stale-target re-anchoring | An optional stale refusal suggests a fresh index and token when one target matches; it never acts on that target. |
| B1 | Benchmark task schema | `bench/task.ts` validates task identity, world, setup, goal, timeout, end state, forbidden effects, cleanup, and workspace-relative paths. Negative tests cover the rules. |
| B3 | Inspectable-state scorers | Pure file, database, setting, API, package, and extracted-value scorers run on a supplied snapshot. |
| B5 | Report rendering | `bench/report.ts` aggregates outcomes, duration, counters, and failure codes into JSON/Markdown-ready data. |

## Left to implement or qualify

| Item | Feature | Work left |
| --- | --- | --- |
| A0 | Real-driver baseline | Run a click and `set_value` in a disposable Windows fixture; record all effect verdicts and per-action latency. Repeat platform qualification before enabling features by default. |
| A1 | Error-path audit | Check every bridge and stage throw/drop path returns a bounded, plain `isError` result. Qualify stale tokens and screen wrapping on a real driver. |
| A2–A5 | Benchmark and hardware gates | Measure each switch on the deterministic pack and a real driver before changing any default. |
| A6 | Final-action risk gate | Resolve targets before activation, send risk to the server control broker, ask the person even at Full access, and test denial and broker outage. The threat-model prerequisite has been read; enforcement and cards are not implemented. |
| A7 | Exact-call approvals | Bind one approval to a hash of the exact call and session; exclude money; remove “Always allow” for final actions. |
| A8 | Failed takeover | Remember a declined or failed sign-in/help request for the same site and turn so it does not open another card. |
| A9 | Visible pointer | Enable and dwell the driver's agent cursor for the person's computer, add a config switch, and inspect it on each platform. |
| A10 | Turn evidence | Send action/verdict/refusal/read-back/latency counters to the server at session end and attach a concise result to the turn. |
| B2 | Desktop worlds | Build isolated Local VM and container worlds with independent filesystem, app state, desktop session, and teardown per task. |
| B3 | Visual fallback | Add screenshot or DOM scoring only for end states that cannot be inspected directly. |
| B4 | First task pack | Add the 15 deterministic scripted tasks, including file GUI work and each listed failure mode. |
| B5 | Executed reports | Version `bench/manifest.json`, run the tasks, and write actual per-task reports under `evals/reports/`. The renderer alone produces no benchmark result. |
| B6 | CI gates | Add the deterministic shard, nightly full-world suite, uploaded reports, and threshold gate. |
| B7 | Opt-in live tier | Run the same tasks with real models; expand the pack before quoting a public number. |
| C1 | Shared operator pipeline | Define the surface contract and qualify container, cloud, and lent computers separately before routing them through the pipeline. |
| C2 | `read_window` | Add the virtual accessible-text tool after C1 settles the virtual-tool boundary. |
| C3 | `computer_batch` | Add bounded batches only if benchmark results show round trips dominate; every call must still pass the gate and pipeline. |
| C4 | Screenshot context cap | Keep only the newest two screenshots in harness-owned contexts. |
| D1–D4 | Model-side experiments | Parked by the plan pending live-benchmark evidence: grounding fallback, reflection escalation, sandbox-only best-of-N, and opt-in trajectory export. |

## Verification so far

The focused isolated fake-driver suite passed 297 tests with three skipped, and `tsc -p tsconfig.server.json --noEmit` passed. `control-omb launch` starts a fake-engine server, and the proxy fixture uses an inert driver. Neither qualifies A0's real-driver behavior. No user's live app or data was used.
