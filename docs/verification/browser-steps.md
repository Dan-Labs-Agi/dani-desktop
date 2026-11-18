# Page health and recorded browser steps

What a bot's page reports (console errors, uncaught errors, failed requests)
reaches the bot in its browser tool results, and a bot set to **Record browser
steps** leaves a screenshot and a short note of each browser action with the
conversation. Design: [the browser engine plan](../plans/browser-engine.md#7-page-health-and-recorded-browser-steps-implemented).

## The automated check

`scripts/testing/browser-evidence.e2e.test.ts` drives the pinned agent-browser
and its Chrome (Chrome for Testing in CI's ui-smoke job, which reproduces the
1280x577 page) against a local fixture page with a load-time console error, a
500 endpoint, a dead port and a flood of 1,100 errors:

```sh
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/browser-evidence.e2e.test.ts
```

Navigation observation also checks a receipt-only page: its static receipt text
must reach the agent, not just its heading or interactive controls. The runtime
requests a noninteractive compact snapshot for this verification. On POSIX, a
second scenario forwards a real Save click to the daemon and drops the
acknowledgement; the local target must receive exactly one submission and the
call must report failure rather than silently replaying it. This is a browser
transport qualification, not a live-model planning check. The previous 0.37.0
CLI has an upstream internal-replay defect; see the
[primary-source browser reliability audit](../audit/browser-reliability-research.md)
for versioned evidence and the secure-upgrade qualification requirements.

Locally, `OMB_AGENT_BROWSER_PATH` and `AGENT_BROWSER_EXECUTABLE_PATH` pick an
installed engine and Chrome instead of the download. It checks, through the
real `BrowserRuntime` and then through the real server and a scripted turn:

1. The click whose POST answers 500 and whose page then throws reports both in
   that one result, quoted as page output; a bot that does not record hears
   the late 500 on its next call, and nothing is written for it.
2. Every recorded step has a 1280x720 JPEG, its page, its target and what the
   page reported; a fill records where the typing landed (never the value),
   and the request's body never reaches a record. A password shown in plain
   text inside an open shadow root keeps the step's picture out
   (`secret-on-screen`) until it is masked again.
3. A POST to a dead port is recorded as pending, and the recording bot hears
   it had no answer after 1.5 s.
4. After the engine's error list rotates at 1,000, the next error is still news
   (full Chrome only: the bundled headless shell stalls on such a flood, as
   the plan's upstream notes say).
5. Killing Chrome: a preview frame starts nothing; the bot's next call starts
   it again at 1280x720, and the bot is told its pages are gone. (A frame or
   read that races a dying Chrome and starts it is noted the same way:
   `server/browser-steps.test.ts`.)
6. `GET /api/threads/ID/evidence`, the screenshot under
   `/api/threads/ID/evidence/GENERATION/step-NNNNNN.jpg` and
   `GET /api/threads/ID/evidence.tar` answer for the conversation, and
   deleting the bot deletes its steps.

`scripts/smoke-browser-bundle.mjs` checks the relay contract on each packaged
engine (macOS, Linux, the Windows build): relayed console, errors, failed
requests, a ref's box and a screenshot after an MCP open.

## By hand

1. Launch the [live browser fixture](browser-live.md). In Pepper's settings,
   Access → Browser, turn on **Record browser steps**. The row says the steps
   stay with the conversation for 30 days; with the browser off it asks for the
   browser first.
2. Script a turn that opens the printed test page and clicks a button (the
   fake engine's scripted steps take `"server": "browser"`), or drive the
   browser yourself and let the bot act. Each browser tool result that changed
   the page ends with `Recorded as step N.`; a page error adds one
   `Page reported …` line.
3. Read the steps back:

   ```sh
   curl -s "$URL/api/threads/$THREAD/evidence" | jq '.steps[] | {step, action, imageUrl, imageSkipped}'
   curl -s -o steps.tar "$URL/api/threads/$THREAD/evidence.tar" && tar tf steps.tar
   ```

4. Take control of the browser during a bot action: that step has no image
   (`person-took-control`), and what the page reported while you held it
   (a failed sign-in, a console error) never reaches the bot or a step. Show
   a password in plain text on a page and act:
   no image (`secret-on-screen`); the same on a checkout page after the bot
   types a card number into the payment provider's card frame, until the page
   moves on. After fill_login fills a one-time code, the steps on that page
   have no image (`code-recently-typed`) until the page moves on or a minute
   passes.
5. Delete the conversation: `DATA_DIR/evidence/<thread>` is gone.

## Browser action approvals and Stop

`/api/internal/browser/mcp` authorizes browser actions for every engine, including
native CLI MCP clients. Known page observations need no write card; a read
that supplies a URL is navigation, not an observation. Input, navigation,
uploads, arbitrary JavaScript and unknown operations require a one-use approval
unless the conversation already has explicit **Full Access**. Approvals are not
reusable by a later call or another conversation.

Cards redact arguments as `<REDACTED>` instead of publishing typed values,
scripts, selectors or file paths. They expire after two minutes. Stop,
disconnection, changed access or a stale turn prevents dispatch. The Chat
Completions driver delegates only the harness-owned browser mount to this gate;
a configured MCP server named `browser` does not bypass its own approval.

Signed HTTP MCP sessions scope cancellation to the caller's own request IDs.
An expired scope may cancel an exact already-accepted request but cannot start
new work. A timed-out browser RPC retains its turn's cancellation owner until
the daemon's outcome is known or termination is proved.

Run the regression scenarios with explicitly selected agent-browser and Chrome
executables. The fixtures create disposable homes and local target pages; they
do not control the installed app or use its profile:

```sh
OMB_AGENT_BROWSER_PATH="$BROWSER_BINARY" \
AGENT_BROWSER_EXECUTABLE_PATH="$CHROME_BINARY" \
pnpm exec vitest run scripts/testing/browser-safety.e2e.test.ts

pnpm exec vitest run server/browser-calls.test.ts server/browser-runtime.test.ts \
  server/browser-engine.test.ts server/browser-processes.test.ts \
  server/harness-mcp-proxy.test.ts server/routes/own-mcp-http.test.ts
```

The real-browser scenarios check denied input, exactly-once approved submission,
Full Access without duplicate cards, a delayed POST stopped before dispatch,
and a second browser continuing its accepted action. They also cover a native
URL-bearing read, cancellation after an RPC returned an unknown outcome, and
native HTTP MCP cancellation. They observe the old daemon/Chrome process tree
exit and then prove fresh same-session work succeeds; an absent POST alone
would not prove interruption. The local model fixture checks that Chat
Completions shows one server-owned approval per action and sends no corrective
model prompts after the broker denies the action.

The POSIX implementation fences queued work and interrupts the verified owned
daemon/Chrome process tree outside the daemon's command queue. Ownership is
checked before any signal, including a reused PID from a stale file.
`OMB_BROWSER_PROCESS_SCOPE` is a stable, non-secret ownership marker that
survives launcher changes to Chrome's HOME; it is not an authorization token.
A fresh browser warns that pages and unsaved input are gone and that an
earlier effect may already have committed. A failed termination proof keeps
the session blocked; closing only the MCP transport is not proof.

If interruption cannot be proved, the Browser panel opens a recovery-only
view: normal input is refused, but **Browser menu → Restart browser…** remains
available. Owned-session recovery requires both retiring MCP clients and the
browser processes to be proved stopped; idle cleanup cannot erase this barrier.
Successful recovery clears its restart warning without discarding unrelated
safety warnings. An attached-Chrome reset explicitly warns that it only reset
the connection, not the person's Chrome or its already-sent page effects.

### Pure admission availability

The server's internal `RuntimeRouter.agentAvailable(session)` query composes
the authoritative state of both browser engines. It launches nothing, queues
no command, reads no page and performs no recovery probe. An active call,
person's hold, pending input/navigation, close/start, uncertainty or unproved
cleanup keeps it false. An unused unregistered session may be available; an
existing old-engine uncertainty barrier is not erased by missing new-engine
state or a profile switch.

This is an admission hint, not a permission grant or proof that an earlier
external write did not commit. Resuming still requires the existing resource
lease and current turn permissions. Native-backend cleanup retains the exact
unclosed backend handle, including late openings. An explicit cleanup retry
must confirm backend closure or its recorded exit before retirement; the
availability query never tries that cleanup itself. Closing an attached
backend retires its connection only; it does not stop the person's Chrome
or undo page effects.

```sh
pnpm exec vitest run server/browser-runtime.test.ts \
  server/browser/session-control.test.ts server/browser/service.test.ts \
  server/browser/engines.test.ts
```

**Release limits:** the Windows hard-stop path is not qualified. The pinned
Windows daemon carries its session identity only in its environment, whereas
the existing Windows process helper can prove only an image name. Stop blocks
new calls and reports uncertainty, but an accepted action may continue; it
must not kill an unrelated process based only on a reused PID. The person's
attached Chrome is never killed and has no global page-effect cancellation
guarantee. Neither case should be advertised as equivalent to verified owned
browser interruption. No platform can retract a request already committed by
the destination site.

## Agent continuation

Browser execution and agent completion are separate. Hermes continues an
explicit next-action announcement or pending ACP plan in the same native
session and logical turn, with the same model, permissions and browser state.
Successful tool outcomes—not plan rewording—permit further continuations.
An initial no-tool announcement gets one correction; another without progress
ends as `incomplete_action`.

Additional client-driven continuation is bounded by 64 prompt rounds and
200 observed tools. Native work inside a prompt retains the harness's own
limits. Questions, Stop, denied/expired approval, failed or unknown work,
and native/provider errors do not authorize another continuation.

The server's trusted denial/failed-tool latch also fences direct and room
turns when a native client labels an MCP error `completed`. Incident/routine
recovery cannot turn that refusal, `incomplete_action`, or a native turn budget
into another automatic attempt. Usage is cumulative across phases; context
occupancy remains the latest reading. Public tool IDs distinguish every native
prompt and keep keyed IDs separate from synthetic ones.

```sh
OMB_AGENT_BROWSER_PATH="$BROWSER_BINARY" \
AGENT_BROWSER_EXECUTABLE_PATH="$CHROME_BINARY" \
pnpm exec vitest run scripts/testing/agent-continuation.e2e.test.ts

pnpm exec vitest run server/drivers/acp/hermes-continuation.test.ts \
  server/drivers/openai-chat-tools.test.ts server/turn-outcome.test.ts \
  server/routine-recovery.test.ts
```

The six serving-path scenarios use the real Hermes adapter, server broker,
pinned agent-browser and Chrome against a disposable local target. They prove
ten ordered, exactly-once effects before one root completion; cookie and
localStorage continuity; a pending-plan phase without an action promise;
persisted cumulative usage; Stop; direct/room denial despite a native completed
status; tool failure; and no-progress termination without an outer replay.
The separate standalone smoke also completed ten phases without navigating
away from its initial page, retaining one native process/session and one usage
ledger row.

The CLI/model is deterministic and local. These checks prove continuation
plumbing and safety, not general model planning quality or a comparative
Stagehand/Pomerado benchmark. A natural-language final answer can still
misstate completion; this is not a semantic task-success verifier.

