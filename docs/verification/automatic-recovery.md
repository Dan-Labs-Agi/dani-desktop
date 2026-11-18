# Automatic recovery

A bot's own backups (Model → Backup models for this bot in Advanced, Bot
settings → Backup AIs in Simple) are used in order with no switch: choosing one
turns it on for that bot. Settings → General → Automatic recovery is off by
default; turned on with one backup engine/model, it covers every bot that has
no backups of its own. The same lists also feed the usage-limit takeover
(`server/host/limit-takeover.ts`), which never needed the switch: at a usage
limit a conversation moves to the first of them that can take over (for one
model's own limit, that AI's default model goes first) and goes back once the
limit resets. When an ACP engine fails during startup, before sending
the prompt or receiving any tool, permission, file or assistant activity, the
driver can report a recoverable failure **only after its process has stopped**.
Claude can also report a refused sign-in before any model or tool activity.
Only its structured synthetic `authentication_failed` API-error frame followed
by an error result with no new cost qualifies. The driver waits for its process
tree to stop before reporting that refusal. Recovery skips
other models on the same engine instance, since they share the failed sign-in.
OMB tries the backup in the same thread with the canonical conversation.
The thread keeps the backup selection; bot defaults and sibling threads do not
change. A visible activity line explains the switch.

Direct bot threads, Chief and direct coordinated work use this path. Channels
and drivers without the startup-proof contract do not. Credential-card
continuations are excluded. This is not recovery from an accepted prompt that
has gone silent: even without output, the engine might have performed actions.
Other authentication failures, quota, invalid-model, safety and approval
failures do not qualify. Neither do a failed backup, Stop, or newer queued input.

Existing approval, organisation-model and spend-limit gates run again. An
engine switch requiring a new Full/Custom grant is refused, not downgraded or
auto-approved. The backup must retain the source engine's tools/attachments
and use the same pinned working folder; legacy unpinned threads and remote
runner changes require a manual choice. Backup provider charges may apply.

## Chief supervision without a provider switch

Ordinary person-origin Chief requests already own a coordinator root; `/goal`
is not required to supervise delegated work. A failed or stalled awaited work
assignment is not completed just because the Chief successfully sends a
message saying it will report the failure. The same root carries the original
brief, completion criterion and observed evidence into a bounded supervision
continuation. The Chief must assign concrete remaining work with `rework=true`,
check what already happened, and avoid repeating completed effects.

The same policy covers an ordinary direct request to a teammate when the host
can identify its authorized, same-person Chief and trusted incomplete work.
The original teammate root stays accountable and waiting while a Chief
supervision assignment runs beneath it. Its one narrowly scoped recovery edge
may return remaining work only to that original worker's exact conversation.
This is not permission to assign back to arbitrary ancestors. The original
worker receives the reviewed receipt and finishes the original request; Stop,
newer user instructions and changed Chief/tenant access invalidate admission.
No matching authorized Chief means no automatic adoption.

That exact recovery edge uses the intersection of the original worker's grant
ceiling, its current permission and native engine support. It neither lowers
the worker to a review-only Chief's Ask nor borrows a Chief's Full to widen the
original worker's Ask. The Chief's own tools keep the Chief review level.
Original-worker authority does not flow to other bots, threads or unrelated
handoffs. Provider-specific Custom rules cannot be reconstructed from a level
label and fail closed for automatic recovery.

A successful provider turn can also leave a multi-step task unfinished.
`HostTurnResult.needsVerification` is trusted host state for eligible ordinary
direct work with an authorized Chief and multiple observed tool calls or a
broker-owned browser operation—not a prose-based failure classification or a
generic judge for text-only/single-read Q&A. That root waits
for Chief verification with no fabricated failure outcome. Its immutable
supervision receipt records `unverified` rather than `failed`; a concrete
remaining-work/verification receipt is still required before completion.
Unflagged successful results retain their existing behavior.

Stopping the original request synchronously cancels the adopted supervision
subtree, including a running Chief and its derived worker turns. Their abort
signals reach the existing host interrupt path, and stale Chief MCP requests
cannot enqueue further work even before a late provider result arrives.

Recovery handoffs retain their failed assignment's completion criterion when
the Chief does not supply a replacement. A successful recovery receipt can
resolve that failed assignment; the original failure and its observed errors
remain in the stored tree and the review envelope. Repeated Chief turns with
no concrete remaining-work action park visibly for a person rather than report
success or loop forever.
Direct adoption stores an immutable execution receipt on the Chief assignment,
distinguishing actual failure from unverified provider success, so original
errors and observed completed effects survive the worker's later final turn.

Supervision also counts executions since the last explicit person answer
against the existing runtime execution limit. A child's failure/settlement does
not renew that recovery window. Exhaustion parks visibly as a budget blocker;
a person can resolve the prerequisite and explicitly resume, without replaying
completed work. Model/default answers do not renew that window.

Trusted denial, authentication/prerequisite and uncertain-execution outcomes
park through the existing runtime question/answer lane. They are not a grant
to retry or switch provider. A resource wait remains queued behind the host's
authoritative busy check; the existing coordinator tick admits it once free.
Stop and newer-message ownership fences remain authoritative. Consultation,
one-way notices, one-shot answers and unrelated autonomous roots do not gain
this Chief supervision policy.

The isolated scenario is runnable with:

```sh
pnpm exec vitest run server/runtime-coordinator.test.ts -t 'ordinary Chief task supervision'
pnpm exec vitest run server/long-running-chief.e2e.test.ts -t 'supervises a stalled teammate through remaining work'
pnpm exec vitest run server/runtime-coordinator.test.ts -t 'direct teammate task adoption'
pnpm exec vitest run server/long-running-chief.e2e.test.ts -t 'has the authorized Chief supervise an ordinary direct teammate request'
pnpm exec vitest run server/long-running-chief.e2e.test.ts -t "verifies an ordinary direct multi-step worker's successful partial pause"
```

These are deterministic regression scenarios, not evidence that a real model
completed the user's browser task. The server scenario uses a disposable home,
an injected watchdog stall and a gated final receipt; it requires remaining
work before the original request can complete. The host must suppress final
success/notification while that coordinator root is still queued, waiting or
parked, and propagate trusted blockers rather than only provider transport
success.


## Repeatable checks

```sh
pnpm exec vitest run server/automatic-recovery.test.ts server/automatic-recovery.e2e.test.ts server/drivers/acp/acp.test.ts server/drivers/retry.test.ts server/turn-dispatch-guard.test.ts server/config.test.ts src/components/AutomaticRecoverySettings.test.ts src/state/store.test.ts
pnpm exec vitest run server/drivers/claude-auth-recovery.test.ts server/drivers/claude.test.ts
pnpm exec vitest run server/direct-coordination.e2e.test.ts server/guarded-messages-api.test.ts server/acp-recovery.e2e.test.ts --maxWorkers=2
pnpm typecheck
pnpm lint
pnpm i18n:check
```

The recovery integration suite launches `launchVerificationServer` in a
temporary home, then configures only fake ACP and Claude engines there. It
checks one backup dispatch, a bot's own list with Automatic recovery on and
off, no dispatch to the app-wide backup while it is off, retained history, one
user message, unchanged permissions/defaults/siblings, bounded failure, no
replay after prompt/output, Stop/new-message precedence and settings validation. A signed-out fake Claude
recovers through fake Codex with one user message and unchanged bot defaults
and permissions. Driver checks refuse recovery after activity or failed cleanup.
A coordinated specialist
recovers through the real agents proxy and returns one result and one final
Chief reply. Each fixture prints a
retained `.log.automatic-recovery.json` evidence path, then removes its own
temporary data and processes. No live app, provider account or user data is
used. Driver tests also cover failed cleanup and pre-prompt file/tool activity.

Settings tests cover the real component's controls, drafts, validation and
save errors. These are not an Electron visual walkthrough or proof of a real
provider's availability, model quality, or a general cure for idle timeouts.

## Simple mode

Simple's Bot settings (the gear on the bot panel) shows the same list as
**Backup AIs**: Add and change open the Simple model menu without the bot's own
AI or ones already listed, the bin removes one, and the list keeps its order (up
to five). There is no switch; the card says when a backup is used.

```sh
pnpm exec vitest run src/components/bot-panel/BackupAis.dom.test.ts src/components/BotSettingsDialog.simple.test.ts src/components/bot-settings/ModelSection.test.ts
```

The pictures come from `control-omb ui launch --engine codex` (fake Claude and
fake Codex in a disposable home): adding Codex in Simple saved
`fallback: [{ instanceId: "codex", model: "gpt-fake-default" }]` on the bot and
left `automaticRecovery` at `{ enabled: false }`.

| Before | After |
| --- | --- |
| ![Bot settings before](evidence/simple-backup-models/before-bot-settings.png) | ![Bot settings with one backup](evidence/simple-backup-models/after-bot-settings.png) |

| Adding | Changing | At 390px |
| --- | --- | --- |
| ![The Simple model menu for a new backup](evidence/simple-backup-models/after-add-menu.png) | ![The same menu with the backup checked](evidence/simple-backup-models/after-change-menu.png) | ![The card at phone width](evidence/simple-backup-models/after-phone-390.png) |

Advanced shows the same list under Model, with words that no longer depend on
the switch: ![Advanced Model section](evidence/simple-backup-models/after-advanced-model.png)
