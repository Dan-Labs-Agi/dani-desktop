# Local agent execution audit — 2026-11-12

Scope: read-only inspection of the existing app and native configuration, plus disposable regression fixtures. No user task was resent, browser tab closed, credential changed or live app/data mutated for diagnosis.

## Observed baseline

- Working tree baseline: branch `fix/dani-onboarding-updates-compact-sidebar`, commit `3a7797656f`, behind origin by one commit. Existing staged count zero, unstaged 63, untracked 12 at first inspection; all preserved. Canonical origin is `Dan-Labs-Agi/dani-desktop`; newer origin commit contains two unrelated test fixes, not the runtime/release repairs here.
- Runtime: Node 26.8.1, pnpm 10.33.0, macOS x64. Repository license/NOTICE identify Apache-2.0 and preserve bundled third-party attributions.
- `GET http://127.0.0.1:8799/api/health` identified the existing static app as PID 1174. Process metadata showed it started at 13:39, before the source continuation changes.
- Selected live bot metadata and native event sources identify legacy Dani-Free and Codex execution, not the current source's canonical Hermes adapter. Browser-tool failures were terminal `tool_error` events. A separate recent Codex failure was an authentication prerequisite, not a failure that unattended retries can repair.
- PATH Hermes reports 0.15.2 under Homebrew Python 3.14. The explicitly selected existing managed virtualenv reports Hermes 0.21.3 / Python 3.11.15. Its CLI exposes profile creation without requiring a global upgrade. Version identities must not be conflated.
- Native configuration selects `muse-spark-1.3-contributor-free` through the existing custom OpenCode loopback provider. API retry count is five; coding verification-on-stop is disabled. No provider key or private prompt is retained in this note.

## Ranked diagnosis and predictions

1. **Confirmed deployment mismatch.** Source/fixture improvements were not loaded by the running package. Prediction: a separately hosted current source build will report Hermes execution for new tasks; changing source alone cannot alter the old process.
2. **Confirmed loss of supervision semantics.** Runtime tests permit a Chief's report/promise after a stalled teammate to complete the request. The parent-run RED in `runtime-coordinator.test.ts` observed `completed` where a supervised remaining-work state must remain queued. A direct-worker request also needs an authorized Chief path, not only a Chief-origin delegation.
3. **Confirmed source-level recovery conflation.** Native continuation and host flags treat any failed tool as a permanent blocker, mixing a harmless failed observation with denial/unknown consequential execution. Prediction: bounded read recovery can finish after a transient observation error while denial/uncertain-write cases remain blocked.
4. **Confirmed browser ownership and evidence defects.** The screenshot's busy text is a generic preview-wait indicator, not authoritative ownership. A failed first takeover/restart retains an owner but did not start the existing expiry policy. Parent-run reservation tests fail on retained ownership; static receipt tests also fail because automatic observations omit noninteractive text.
5. **Confirmed hidden engine retry risk.** The actual pinned 0.37.0 lost-ack regression accepted five click frames where one was required. A safe retry policy in Dani cannot undo hidden CLI resends. Candidate qualification must prove no replay and preserve structured `outcome_unknown`.
6. **Confirmed incompatible model boundary.** The owned real-model browser run used Hermes 0.21.3 and serialized a browser-only MCP mount. Its native cache registered 32 browser schemas before the prompt. The configured `127.0.0.1:4187` service nevertheless discards caller `tools`/`tool_choice`, starts an OpenCode `build` agent, and returns final text. A forced client-tool probe returned HTTP 200, finish reason `stop`, and zero tool calls. The model's claimed `webfetch` use has no Hermes execution evidence.
7. **Confirmed zero-activity false completion.** That browser-directed worker's text-only blocker ended with `requestPending: false` and a completed runtime root. Eligibility based only on already-observed tools misses an execution path that cannot call tools at all. Declared browser intent must remain unverified; unavailable authorized supervision must park the request rather than certify it.

## Provider compatibility and authorization

The active proxy implementation is `~/.hermes/opencode-proxy/server.ts`; it is not a transparent inference endpoint. Its text-only extraction also drops images and structured tool-result associations. Mounting tools into its inner OpenCode agent or enabling text-protocol emulation would not make Hermes the execution owner.

The [official OpenCode model documentation](https://opencode.ai/docs/console/models/#endpoints) restricts free-tier chat models to OpenCode clients. [Maintainer confirmation](https://github.com/anomalyco/opencode/issues/56702) states that third-party free-tier API calls are intentionally rejected. No credential export, client-identity spoofing, quota circumvention, or paid fallback is an acceptable fix.

The user chose to retain Hermes and connect a compatible provider, then completed native OpenAI device authorization in the isolated profile. The account-scoped catalog advertised GPT-6-Astra and GPT-5.6-Sol/Terra/Luna. GPT-5.6-Sol passed the native nonce-tool/result roundtrip on `https://chatgpt.com/backend-api/codex` with `codex_responses`; no API-paid fallback was introduced.

An actual restored app conversation still failed after authorization. Credential-free HTTP diagnostics showed `POST /backend-api/codex/chat/completions` returning 404 with 32 browser schemas. Native constructor tracing identified Hermes 0.21.3's `SessionManager._restore` restoring a stale `chat_completions` mode; ACP `set_session_model` preserves that mode on a same-provider switch. Fresh native ACP sessions succeeded, so a new-chat workaround would conceal the defect. The app-owned qualified bootstrap now enforces endpoint-mandated wire protocols, including the exact HTTPS ChatGPT Codex endpoint, while preserving model, credentials, endpoint and history. Real-constructor regressions failed before and passed after, including custom/lookalike-host negative cases and scoped/unscoped execution.

## Existing owners to reuse

`server/runtime` and `runtime-coordinator.ts` own durable work, requester wakes, waiting and continuation. `directRequestOwners` binds original user request/generations. Goal cards expose outcomes. The watchdog owns stalls. BrowserRuntime owns control/uncertainty; BrowserLive owns existing idle/disconnect clocks. Existing coordinator ticks own availability re-admission. Adding another general scheduler or model service is not required.

## Delivery and evidence boundary

The source UI is served at ports 8811/8812 in `~/.danibot-local`, using native profile `~/.hermes/profiles/dani-local`. After the protocol correction, the original failing conversation executed the real browser goal and verified three exact TodoMVC items, two active and one completed. Native browser tool records and HTTP Responses 200 establish execution, not just a displayed catalog. Browser-control fault fixtures and real 0.41.2 binary scenarios remain separate evidence; this does not establish correctness on every website or alternate native OS backend.
The user subsequently began real work in this local workspace, so it is no longer a disposable verification target. Further mutation tests require a separate fixture. Its primary Dani was found without a Research supervision grant and still pinned to the obsolete proxy; the user's explicit whole-team supervision instruction authorized correcting that grant and choosing the authenticated Codex model. Resuming a previously parked verification obligation when the authorized Chief becomes available requires separate runtime qualification.

Primary-source research and independent scope maps are recorded in `docs/audit/hermes-goal-reliability-research.md`, `docs/audit/browser-reliability-research.md`, and `docs/audit/release-pipeline-2026-11-12.md`. The implementation/acceptance contract is `specs/140-supervised-agent-recovery/spec.md`.
