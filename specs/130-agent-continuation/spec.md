# 130 - Progress-aware agent continuation

Status: IMPLEMENTED. Locally verified with deterministic native/model fixtures and pinned agent-browser 0.37.0; not a live-model capability qualification.

## Problem and evidence

The browser engine executes actions; the agent/harness decides whether to continue. Browser permission and process-interruption changes do not establish long-horizon task behavior.

The isolated RED command is:

```sh
pnpm exec vitest run server/drivers/acp/hermes-continuation.test.ts \
  server/drivers/openai-chat-tools.test.ts \
  -t 'unfinished action|ten progress-making phases'
```

It produced three failures: Hermes reported success for a bare unfinished action, the Hermes workflow stopped after its first of ten stages, and Chat Completions stopped after three progress-making stages. These are source-proven failure paths, not evidence identifying the user's particular last conversation. A provider outage, explicit budget, human-input wait or Stop remains a distinct cause.

Serving-path failure injection also exposed an outer incident retry that
started a fresh turn after a denied/failed native browser operation. Review
regressions exposed prompt-local usage overwriting root totals and collisions
between native and synthetic public tool IDs. Those paths have dedicated
failing-before/passing-after checks.

## Requirements

- R-CONT-001: A native `end_turn` or chat `finish_reason=stop` is a response boundary, not sufficient evidence that an explicitly unfinished task is complete. Self-authored next-action announcements and an ACP plan with pending/in-progress entries must not be silently promoted to successful completion.
- R-CONT-002: Continue unfinished work in the same logical turn, native session, model/provider, permission scope and browser state. Do not resend the original request, restart the browser, replay successful writes or release the turn's capability between phases.
- R-CONT-003: Allow continued phases while actual tool progress is being made. Remove the three-nudge ceiling that ends a progressing task; retain a finite 64-round continuation budget and 200-tool continuation boundary. Do not increase the existing Chat Completions round/tool limits. Native harness internals retain their own limits; this boundary limits additional client-driven continuation.
- R-CONT-004: An initial unfinished announcement may receive one corrective continuation; another announcement without tool progress must end as `incomplete_action`, not spin or pretend success. Plan rewording alone is not tool progress.
- R-CONT-005: Stop, denied/expired permission, pending human questions, unknown in-flight work, provider failures and quota/budget exhaustion remain terminal or explicitly blocked. Continuation does not authorize any tool and must not blindly retry a failed/uncertain write.
- R-CONT-006: Preserve cancellation, native errors, cumulative usage, streamed text, context compaction and tool-result correlation across phases. Native tool IDs reused in a later prompt must not overwrite an earlier phase's activity or count as duplicated completed work.
- R-CONT-007: Enable the native behavior on the shipping Hermes adapter. Other ACP providers keep their existing behavior unless explicitly opted in. Reuse one conservative pending-action detector and continuation prompt across native and Chat Completions paths.
- R-CONT-008: Preserve trusted broker denial and failed-tool provenance across native status/error shaping. Both direct and room dispatch supply the server-owned continuation fence. Outer incident/routine recovery must not restart denied/failed work, a no-progress `incomplete_action`, or a native turn budget.

## Design contract

`server/drivers/task-continuation.ts` owns the conservative `announcesAction` detector, continuation instruction, limits and a per-turn progress fence. The existing Chat Completions loop and native ACP prompt owner consume this policy; no second scheduler, provider, browser engine or persistent job ledger is introduced.

The ACP owner remains `AcpTurn`; it keeps one logical turn through repeated `session/prompt` requests on the same session. Native structured plan state and completed tool outcomes are tracked from native notifications, never webpage instructions. Prompt-local text and tool identifiers are correctly scoped while root-turn usage/cancellation remain cumulative. The existing broker remains authoritative for every browser action.

The server owns `SendTurnInput.continuationAllowed`: it binds continuation to
the current capability generation and trusted `TurnStops` failure provenance.
Native status wording is not an authorization decision. The recovery policy
consumes the same provenance rather than guessing from provider error text.

This is not a universal semantic task-success verifier. A natural-language reply can falsely claim success; this slice prevents the demonstrated premature-response and pending-plan paths and proves a controlled long workflow. Do not claim broad model capability from deterministic fixtures.

## Given/When/Then acceptance

| ID | Given | When | Then |
| --- | --- | --- | --- |
| AC-CONT-001 | Hermes returns only a next-action promise with `end_turn` | It makes no progress on the corrective prompt | One logical turn fails explicitly as incomplete rather than succeeding. |
| AC-CONT-002 | Ten progressing phases with intermediate final-style announcements | The next native/chat response ends | All ten effects occur once before one root-turn completion; no three-nudge stop. |
| AC-CONT-003 | A native plan still has pending entries | The agent emits an intermediate non-promise summary | It continues remaining work rather than declaring task success. |
| AC-CONT-004 | The agent asks a human, receives a denial or is stopped | A response ends | No hidden continuation or repeated write occurs. |
| AC-CONT-005 | A native prompt fails or ends on a provider/quota error | Continuation is considered | The real failure is preserved, never converted into success or a paid fallback. |
| AC-CONT-006 | A continued native prompt reuses a tool ID | It completes | Public activity and progress remain correlated with the correct phase. |
| AC-CONT-007 | A multi-step browser workflow in an isolated server | The model/CLI fixture pauses between stages | Real browser state persists and target-side receipts prove exact completion without duplicates. |
| AC-CONT-008 | A progressing loop reaches the round/tool budget | More work is explicitly pending | It reports incomplete/limited work without repeating prior effects. |
| AC-CONT-009 | A broker denies an action that the native CLI marks completed | A direct or room response announces further work | Neither another native prompt nor an outer automatic root retry starts. |
| AC-CONT-010 | Several native prompts report usage and the last reports only context occupancy | The root turn settles | Earlier input/output/cache usage remains in the cumulative consumer/ledger totals. |

## Verification

Use `docs/verification/README.md` and the real shipping adapter with a disposable native CLI/model fixture. Keep failing-before/passing-after regressions at the loop seam. Exercise the pinned browser on a local multi-stage target through the actual server and broker; task completion is proved by target-side state, not the fixture's final sentence. Run affected ACP, model-loop, denial/cancellation and static checks. Inspect the actual serving path through a throwaway smoke and remove it afterward.

Local serving-path proof: all six scenarios in
`scripts/testing/agent-continuation.e2e.test.ts` and all eight browser safety
scenarios passed with the bundled agent-browser and Chrome. A standalone
`control-omb` smoke also observed ten ordered target receipts, no duplicate
attempts, persistent cookie/localStorage state on one page, one native
process/session, one root completion, and one cumulative usage ledger row.
No live provider, installed app profile or user data was used.

The final 16-file targeted regression run passed 518 tests after the denial,
corrective-prompt and cap-handoff fixes. `pnpm typecheck` and `pnpm lint` passed.

## Non-goals and limits

No Stagehand/Pomerado adoption, arbitrary automatic retries, ignoring approval/Stop, disabling watchdogs, unlimited model calls, paid fallback, new global orchestration framework or claim of universal task verification. Windows hard browser interruption remains separately unqualified; it is not a long-horizon loop fix.
