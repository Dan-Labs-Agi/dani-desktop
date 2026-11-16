# 140 — Supervised goals, safe recovery and usable local delivery

Status: IMPLEMENTING. Native OpenAI tool/result qualification and the original restored-conversation browser goal passed, including a failed observation followed by verified completion. Final supervisor recovery, configured-proxy integration and release gates remain separate acceptance checks.

## Problem and observed evidence

The user reports that a teammate stops after one attempt and asks purple Dani to supervise the work through completion, rather than require repeated user prompts. The supplied screenshot shows a worker claiming person-held browser control while its panel displays an agent-busy/connecting message. Those messages alone do not establish current ownership.

Read-only inspection found the running static app on port 8799 still executing the legacy Dani-Free and Codex adapters, while the working tree makes Hermes canonical. Recent logs show browser tool errors terminating work; a separate recent Codex failure required renewed authentication. The installed PATH Hermes is 0.15.2. A separate existing managed virtualenv is associated with 0.21.3 and still requires runtime qualification. Prior deterministic fixture results did not deploy new source into that running app.

Research and RED regressions also found that automatic browser observations omit static receipt text, the pinned 0.37.0 CLI can resend a submitted click after a lost acknowledgement, native structured `outcome_unknown` is not latched, failed first browser takeover/restart reservations can miss their existing expiry clock, and release artifact/feed checks are incomplete. Primary-source research lives under `docs/audit/`.

A later owned real-model smoke registered 32 native browser MCP schemas but produced no tool calls: the configured local model endpoint discards caller tools and runs an inner OpenCode agent. A forced-tool protocol probe also returned zero tool calls. The worker's blocker was incorrectly counted as successful request completion. The user chose to keep Hermes and connect a compatible provider; no paid fallback or free-tier access workaround is authorized.

## Requirements

- R-140-001: Retain the user's original goal, accountable worker and existing request identity across intermediate responses, recoverable failures and supervision. Use the current coordinator/runtime, not a second queue or agent framework.
- R-140-002: Purple Dani supervises incomplete teammate work: inspect progress/evidence, assign concrete remaining work or safe recovery, and report a real human prerequisite when one exists. An intermediate pause, promise or provider `end_turn` is not successful task completion.
- R-140-003: Recover a transient failed observation or corrected non-effectful operation within a bounded retry budget. Retry accounting is separate from successful progress, preserves the original error, and does not silently change provider/model.
- R-140-004: Stop, denial, revoked scope, newer user instructions, uncertain consequential effects and genuine human control remain authoritative. An uncertain external write is reconciled or explicitly blocked, never blindly repeated.
- R-140-005: Distinguish recoverable tool failure, permission refusal, resource waiting and unknown execution with typed trusted state. Do not classify all failed tools as permanent denial or rely on page/model text as authorization.
- R-140-006: A failed takeover/restart reservation expires through the existing hold policy without erasing interruption/uncertainty. Work awaiting a genuine human handback remains resumable; current authoritative ownership—not historical assistant prose—decides availability.
- R-140-007: Preserve native session/model, compaction, usage, tool correlation, approvals and cancellation. A bounded no-progress or cost limit remains visible and resumable rather than spinning indefinitely or claiming success.
- R-140-008: Browser task verification includes current static success/error/receipt content as well as actionable refs. No internal CLI transport retry may repeat an already-submitted consequential operation after response loss.
- R-140-009: Qualify the minimum compatible browser release with the upstream no-resend fix and applicable security fixes, actual MCP schemas, licensing/digests and existing packaging targets. Preserve platform limitations not exercised locally.
- R-140-010: Provide a real locally hosted current UI/backend using Hermes and an explicitly approved compatible model/provider. Reject agent-as-model endpoints and require genuine native tool/result qualification, not catalog membership alone. Keep the existing live app/data untouched; use a separate persistent workspace/profile and do not print credentials or private prompts.
- R-140-011: Exercise a real authorized model on a harmless disposable browser workboard with a recoverable failure and exact target-side receipts. Scripted model/CLI fixtures remain regression evidence, not autonomy evidence.
- R-140-012: On adopted-branch packaging pushes, CI validates the complete combined artifact set, update feeds, checksums, platform identity and stable aliases before a release can publish. Feature-branch pushes must not publish production updates.
- R-140-013: Updater source and Linux packaging match the canonical desktop release. Auxiliary browser-engine releases, missing feeds, errors, prerelease/version ordering and signing/bootstrap limits are reported accurately. No publication, remote settings mutation or user-data migration without authorization.
- R-140-014: Keep Hermes as the root execution harness, not a user-facing model group. Show actual models grouped by provider, including configured proxy catalogs. Preserve exact endpoint, credentials, protocol and model identity; unavailable or restricted routes remain visible and cannot silently substitute another provider.
- R-140-015: A worker's avoidable clarification does not certify completion. An authorized Chief reviews safe remaining work. A goal parked only because that Chief was unavailable is re-admitted when the prerequisite is fixed, using the same owned root without another user message. Stop, newer requests, genuine human prerequisites and uncertainty remain authoritative across restart.
- R-140-016: Bind the selected native provider before new/restored session construction, enforce endpoint-required protocols, and retain conversation history without modifying the saved native default or forwarding unrelated credentials.

## Ownership and design constraints

The existing coordinator/runtime owns assignments, requester wakes and durable work state; goal cards expose outcomes. Hermes remains the execution harness. The server browser broker owns approval and effect dispatch. BrowserRuntime owns session/control/uncertainty; existing hold clocks and coordinator ticks own expiry and re-admission. Native API-request retries remain Hermes-owned; Dani owns bounded task recovery and supervision. No independent generic model judge, duplicate scheduler or global Python-package patch is introduced.

Keep explicit browser-only route/tool constraints. Native Hermes browser tools are not the same browser session as Dani's MCP mount; supported tool construction/enforcement must be verified before claiming broker-only confinement. Configuration values ignored by ACP constructors are not a fix.

## Acceptance

| ID | Given / when | Required result |
| --- | --- | --- |
| AC-140-001 | A teammate pauses with unfinished delegated work | Dani retains accountability and issues concrete remaining work without the user repeating the goal. |
| AC-140-002 | An observation fails transiently, then succeeds | Recovery occurs within budget in the same owned task and final evidence matches the goal. |
| AC-140-003 | A permission is denied, Stop is pressed, or an effect's acknowledgement is lost | No unauthorized continuation or duplicate consequential effect occurs. |
| AC-140-004 | A first takeover/restart fails and its existing lease expires | Ghost ownership clears; uncertainty and real person ownership remain protected. |
| AC-140-005 | A real model receives a local browser workboard with a temporary read failure | It uses the actual browser, completes the requested change once, and verifies the receipt/state. |
| AC-140-006 | Current local UI is opened | Actual frontend renders, the selected execution harness is Hermes, and the provided local URL stays usable. |
| AC-140-007 | A stable alias, blockmap, feed, hash or platform artifact is missing/wrong | Release validation fails before publication, including branch-push packaging checks. |
| AC-140-008 | Repository permissions/signing/current release cannot establish auto-update delivery | Exact external prerequisite is surfaced; no unsupported update-success claim. |

## Verification and rollout

Write focused behavioral RED regressions before production changes, then run the affected matrix once integrated. Use disposable homes/local targets for mutations. Run the current app surface in a separate workspace, perform a real-model browser smoke there before handoff, then leave the local service running for the user. Verify actual user-visible state and process/model identity. Remove temporary probes and keep only non-sensitive evidence. CI publication and platform signing require their real external permissions/artifacts; local tests do not substitute for them.
