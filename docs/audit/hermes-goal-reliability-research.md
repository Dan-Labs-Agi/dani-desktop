# Hermes goal reliability: versioned research

Date: 2026-11-12. Scope: read-only source/document research; no builds, tests, model calls, app mutations, installation or deployment. `CONFIRMED_BY_SOURCE` means the cited implementation was inspected, not that the running Dani app exercised it. Recommendations are not implemented by this note.

## Bottom line

Hermes supplies a tool-calling loop, API-error recovery and persistent conversations. **An ACP `end_turn` is not proof that the user's goal succeeded.** The inspected direct ACP adapter does not run Hermes' persistent `/goal` manager. Dani should retain its existing turn/goal owner, continue safely in the same native session, and distinguish a failed observation from a refused permission or an uncertain external write. Increasing an unused YAML turn limit, adding more exhortations, or substituting another model is not a fix.

## Versions and actual invocation

Three different evidence sets must remain separate:

| Evidence | Observed version/identity | What it establishes |
| --- | --- | --- |
| PATH `hermes` launcher | Homebrew Python 3.14; installed distribution metadata `hermes-agent 0.15.2` | Its launcher imports the Homebrew site-package implementation. Parent separately confirmed `hermes --version` reports 0.15.2. |
| Existing managed installation | `~/.hermes/hermes-agent/venv/bin/hermes`; Python 3.11; editable metadata 0.21.3 | Launcher executes its adjacent interpreter. Editable mapping points to the same checkout to which `~/.hermes/hermes-agent` resolves. This avoids a global Python/package upgrade. |
| Remote upstream source pins | [`01382698fc32ec7740b6a204d9b7a6abeac74d33`](https://github.com/NousResearch/hermes-agent/tree/01382698fc32ec7740b6a204d9b7a6abeac74d33), matching observed checkout HEAD; newer main snapshot [`72c880370ff2e47dd587982ddded1b1ce90cfde4`](https://github.com/NousResearch/hermes-agent/tree/72c880370ff2e47dd587982ddded1b1ce90cfde4) | Version-specific contracts, not proof that either implementation is loaded by packaged Dani. Local working files can differ from their HEAD; remote pinned files were also consulted. |

Repository comments mentioning 0.22.4 are not an installed-version contract. The newer main snapshot even uses `version = "0.0.0"` in [package metadata](https://github.com/NousResearch/hermes-agent/blob/72c880370ff2e47dd587982ddded1b1ce90cfde4/pyproject.toml); use a commit and runtime identity, not an assumed release number.

**Smallest local-hosting recommendation:** select the existing explicit `~/.hermes/hermes-agent/venv/bin/hermes` executable in the engine instance; bind `HERMES_HOME` to a separate Dani-owned profile; retain the user's explicitly selected provider/model and permission scope. Confirm its imported module path/version and ACP initialization in that isolated runtime before claiming availability. `~/.hermes/hermes-agent/hermes` has an `env python3` shebang and is not an equivalent interpreter pin. No interpreter upgrade, live-home rewrite, credential dump, or installation is needed for this recommendation. The executable was inspected, not launched by this research slice.

Parent's separate read-only diagnosis found the existing packaged app had been running a Dani-Free provider and an expired-auth Codex task, not the current Hermes-only source. Treat that as deployment/provider-selection evidence from the parent, not a result proved by this research. Fixture/source repairs do not modify an already-running package.

## Native semantics, not model promises

### Prompt completion and task plans

`CONFIRMED_BY_SOURCE`:

- ACP defines one `session/prompt` as a complete interaction cycle that can include multiple model exchanges and tools. Its final result carries `stopReason`; tools/plans stream as `session/update`. `end_turn` ends a prompt turn, not a durable user goal. [ACP prompt-turn specification](https://agentclientprotocol.com/protocol/v1/prompt-turn).
- Installed 0.15.2 `acp_adapter/server.py` calls `agent.run_conversation`, persists returned history, then maps every non-cancelled result to `end_turn`. Its exception handler converts an exception into `final_response: "Error: ..."`. The remote pinned direct adapter likewise returns `cancelled` or `end_turn` in `_finish_turn`, without projecting every core failure into a failed ACP result. [Pinned direct adapter](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/acp_adapter/server.py).
- Installed 0.15.2's ordinary no-tool-call branch treats nonempty model text as final; special recovery exists for empty/thinking-only/truncated replies. A capable model can still say "I will inspect it" and stop without executing a tool. Raising an iteration ceiling does not compel another call.
- Installed `acp_adapter/events.py` maps native `todo` results to ACP plans. `pending`/`in_progress` remain unfinished; native `cancelled` maps to ACP `completed` with a `[cancelled]` content prefix because ACP has no cancelled plan status. A checked plan alone is not acceptance evidence. [Pinned event bridge](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/acp_adapter/events.py), [ACP agent plans](https://agentclientprotocol.com/protocol/v1/agent-plan).

Newer upstream is materially different: its [gateway ACP projection](https://github.com/NousResearch/hermes-agent/blob/72c880370ff2e47dd587982ddded1b1ce90cfde4/acp_adapter/gateway_server.py) waits for the exact admitted prompt's terminal result, raises `admitted_turn_failed` for failure, returns `cancelled` for cancellation, preserves an input identity after an unacknowledged submission, and refuses blind resubmission of an unknown execution. This is a useful reference for ownership/reconciliation, **not a feature to assume in 0.15.2/0.21.3**. [Current official ACP internals](https://hermes-agent.nousresearch.com/docs/developer-guide/acp-internals).

### Iteration, API retry and persistent goal budgets are different

| Control | Observed behavior |
| --- | --- |
| `AIAgent.max_iterations` | Installed 0.15.2 defaults to 90 model/tool-loop iterations. Remote pin `01382698` defaults to `sys.maxsize`, described as unlimited, with a budget shared with subagents. [Pinned `run_agent.py`](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/run_agent.py). |
| YAML `agent.max_turns` | Present in config defaults, but neither inspected direct ACP constructor forwards it to `AIAgent(max_iterations=...)`. Changing this YAML alone is not demonstrated to change direct ACP's iteration ceiling. [Pinned constructor](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/acp_adapter/session.py). |
| YAML `agent.api_max_retries` | Actually read by agent initialization. Default 3; clamped to at least 1. In installed source, **1 means a single attempt, not one retry after the first attempt**. It wraps a model API request, not an entire already-executed user workflow. [Pinned initialization](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/agent/agent_init.py). |
| `/goal` budget | Separate outer continuation loop, default 20 prompt turns. It is not automatically enabled by `hermes acp`. [Pinned persistent-goal docs](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/website/docs/user-guide/features/goals.md). |
| Dani continuation | `server/drivers/task-continuation.ts` currently bounds adapter continuations to 64 rounds/200 calls and requires increased completed-tool progress after the first continuation. These are host rules, not Hermes defaults. |

Installed 0.15.2's loop retries recoverable API failures with bounded backoff, handles malformed/truncated responses, and refuses incomplete tool arguments. Ordinary non-retryable account/request failures are not solved by larger budgets. Its fallback code can activate a configured fallback chain; do not introduce one or silently switch providers to make a smoke test pass. Source: inspected installed `agent/conversation_loop.py`, `agent/chat_completion_helpers.py`, and [pinned upstream implementation](https://github.com/NousResearch/hermes-agent/tree/01382698fc32ec7740b6a204d9b7a6abeac74d33/agent).

A concrete one-attempt hypothesis is `agent.api_max_retries: 1`; another is the model returning nonempty prose without tools. Neither is established as the user's actual stop cause. The parent must correlate the selected runtime, native result, tool events and deployed build.

### Persistent goals and outcome verification

Hermes has a real persisted `GoalManager`, not just "keep going" wording. However, the pinned [goal documentation](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/website/docs/user-guide/features/goals.md) explicitly says ACP does not advertise or implement `/goal`; its [command catalog](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/acp_adapter/commands.py) confirms this. Sending `/goal` through that adapter can become ordinary model text, not activation of a native goal loop.

Version differences matter:

- Installed 0.15.2 `hermes_cli/goals.py` uses a judge over the latest response; its old judge prompt treats a genuine blocker/need for user input as `done`. That is loop termination, not successful outcome verification.
- [Pinned newer `goals.py`](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/hermes_cli/goals.py) distinguishes `done`, `blocked`, `continue`, `wait`; completion contracts carry `outcome`, `verification`, `constraints`, `boundaries`, `stop_when`. It requires concrete verification evidence and supports deterministic quality gates. Default gate retry budget is 3; judge parse failures pause after 3, transport failures after 5. Wait barriers park rather than spend turns repeatedly poking running work.
- The managed/pinned [verification-stop module](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/agent/verification_stop.py) exists and defaults **OFF**. `HERMES_VERIFY_ON_STOP=1` overrides `agent.verify_on_stop: true`; `auto` is surface-sensitive. It is a bounded coding-edit verification nudge backed by an evidence ledger, not a general browser-task verifier, not a command runner by itself, and not activation of `/goal`. No `agent/verification*` module was found in the inspected 0.15.2 installation.

Recommendation: borrow the completion-contract distinction and concrete evidence requirement inside Dani's existing owner. Do not add an auxiliary paid judge or a second native goal loop over Dani's own goal scheduling.

## Tool errors, browser authority and restart safety

### Failed tools should permit safe recovery, not erase authority

Hermes returns tool errors to the model so it can change strategy. Installed loop execution normally continues after tool results; an explicit guardrail halt is separate. Upstream's [tool guardrails](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/agent/tool_guardrails.py) distinguish failures, unchanged observations and progress, warn before repeated-failure limits, and keep attended ACP's ordinary hard-stop behavior opt-in. They explicitly tolerate operational failures in tools such as terminal/navigation rather than interpreting the first failure as universal denial.

Dani source comparison at inspection time:

- `server/drivers/acp/core.ts` permanently sets `continuation.blocked` on **any** failed tool. This prevents a safe follow-up after a failed read, stale selector or later successful correction.
- `server/turn-outcome.ts` sets the same `flags.toolError` for a denied permission and any failed tool. Consumers must not treat these as identical replay authority.
- ACP completion currently accepts a reply containing **any `?`** as a stopping signal before unfinished-plan continuation. A quoted question, URL query or incidental punctuation is not an actual pending user question.
- `TaskContinuation.next` measures progress only by successful completed-tool count. A failed read followed by a materially new observation/corrected strategy can be legitimate recovery; repeating an unchanged failing signature indefinitely is not.

These are source-backed integration risks, not proof each one caused the running app's observed failure. Preserve denial/Stop/uncertain-write fences while separating recoverable observations from irreversible effects.

### Native browser tools versus Dani's broker

Hermes supports browser tools over ACP, but that is not automatically Dani's browser session. The pinned [toolsets](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/toolsets.py) include native browser tools in `hermes-acp` while excluding native `computer_use` and clarify. The pinned [browser guide](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/website/docs/user-guide/features/browser.md) describes packaged local Chromium, explicit CDP attachment and a newer `browser_exec` path when browser-use is available; that executes Python and requires terminal capability. Current online tool names differ from older installed `browser_navigate`/`browser_click` schemas. Browser dependency/tool-schema availability is version-specific.

**Important configuration gap:** both inspected direct ACP constructors hardcode `hermes-acp` plus MCP toolsets and omit `disabled_toolsets`. Installed 0.15.2 passes those constructor arguments unchanged to `get_tool_definitions`; managed local source has the same omission. Therefore `agent.disabled_toolsets: [browser]` or `platform_toolsets.acp` alone is **not established to disable native browser tools in these adapters**. An instruction saying "use only Dani's browser" is not enforcement.

For broker-only browser ownership, the minimal managed adapter seam must explicitly forward/apply native tool exclusions and enforce valid-tool dispatch, then prove the resulting tool inventory contains the admitted Dani browser MCP tools and no native bypass tools. Until that capability is demonstrated, refuse narrowed-scope claims rather than granting broader execution. Do not patch the user's global Python package, enable all tools, or substitute cloud browsing/paid providers. Browser-specific repair and its evidence belong to the browser owner.

### Persistence is not exactly-once effects

The direct ACP adapter saves conversation history and restores it through `session/load`/`session/resume`. Loading replays history; those replayed events are not fresh actions. Compression may rotate an internal Hermes session while retaining a stable public ACP handle; [provenance metadata](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/acp_adapter/provenance.py) identifies the compression lineage. Retain the native cursor and re-anchor outstanding acceptance criteria after compaction.

[Filesystem checkpoints](https://github.com/NousResearch/hermes-agent/blob/01382698fc32ec7740b6a204d9b7a6abeac74d33/tools/checkpoint_manager.py) snapshot working directories before file-mutating calls. They are not a rollback mechanism for sent messages, payments, browser submissions or remote actions. The direct ACP constructors do not explicitly enable filesystem checkpoints. Conversation resume, file rollback and unknown-effect reconciliation are distinct mechanisms.

## Practical policy for existing Dani ownership

Recommendations, not new implementation:

| Situation | Minimal permitted next action |
| --- | --- |
| Temporary failure of a read/snapshot/search | Bounded retry of that observation or a corrected alternative; preserve original error. |
| Stale/missing browser selector | Take a fresh snapshot, resolve a current target, retry only after establishing the prior action did not execute. |
| API transport failure before tool execution in that model request | Let Hermes' bounded native API retry own it; avoid multiplying retries across wrappers. |
| Tool/model text ends with remaining work | Continue same session with remaining acceptance criteria and actual results, within existing budgets and stop checks. |
| Permission refused, Stop, changed scope/newer user instruction | Stop or wait under existing ownership; no retry or alternate route around refusal. |
| External write timed out or process died after possible execution | Inspect/reconcile remote state. Unknown is not safe-to-repeat and not completed. |
| All acceptance criteria have observable evidence | Mark goal completed; attach the evidence, not just a fluent claim or plan. |
| Repeated unchanged failure/no progress or exhausted budget | Pause/blocked with exact cause and resumable state; no false success or endless loop. |

Keep changes in current `server/drivers/acp/hermes.ts`, `core.ts`, `task-continuation.ts`, `turn-outcome.ts` and their existing host callers. Reuse current goal/turn/session ownership and stop guards. The older audit documents' references to missing `dani-control-plane.ts`/`dani-kernel` are not viable integration seams. `docs/verification/automatic-recovery.md` already correctly distinguishes startup-safe takeover from accepted-prompt unknown effects; do not broaden it into arbitrary workflow replay.

Required later evidence is layered: deterministic adapter regressions, a real authorized model completing a harmless isolated browser workboard including a recoverable failure, and proof that the served app build actually contains the repaired code and selected Hermes engine. None substitutes for the others. No such live success or deployment is claimed here.

## What does "Grokbot" refer to?

Identity remains ambiguous; do not silently substitute OpenClaw/Clawdbot.

- **Primary local-project comparator:** [OpenMausBot's own README](https://github.com/milind-soni/OpenMausBot/blob/main/README.md) explicitly says it was formerly **OpenGrokBot**, is independently inspired by Grok Bot, and is **not affiliated with xAI**. Its [repository metadata](https://api.github.com/repos/milind-soni/OpenMausBot) describes an open-source Grok Bot alternative. This supports the parent's legacy `~/.opengrokbot` clue, not proof that this is the product the user meant.
- **Clearly labeled xAI product comparator:** [Grok Bot's official overview](https://docs.x.ai/grok-bot/overview.md) describes persistent cloud computers, cross-app work, routines and multiple bots. It does not disclose a retry algorithm or guarantee exactly-once effects. Its marketing description is not a Hermes contract.
- **Distinct coding-agent comparator:** xAI's [Grok Build `/goal` announcement](https://x.ai/news/introducing-goal) describes checklist-based execution until completion and verification, with status/pause/resume/clear controls. This is Grok **Build**, not evidence that the user meant it by Grokbot.

The existing goal plan's statement that the user's remembered `/goal` definitively refers to Grok Build goes beyond the available identity evidence. The transferable requirement is durable, visible pursuit of the accepted goal with verifiable completion and safe stopping—not a product rename or another agent framework.
