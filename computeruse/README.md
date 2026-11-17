# Local computer-use service

`service.ts` is a separate local process started for each computer MCP session. It owns the stdio connection to `cua-driver`, checks every action with the server's control endpoint, records saved-step calls when requested, and normalizes driver responses. The process exits when the MCP session ends.

`local-computer.ts` validates the driver connection that Electron grants to its own server and creates the service launch descriptor. `guidance.ts`, `effect.ts`, and `unconfirmed-click.ts` implement local computer-specific behavior inside that process. The small files under `server/` with the old names are import adapters for the existing server callers.

`pipeline.ts` orders the local relay's typing, click normalization, and optional read-back stages. `session.ts` keeps window fingerprints and guard state for this MCP session. The `features.guardComputerStale` and `features.guardComputerLoops` switches are off unless set to `true` in `config.json`. With the stale guard on, an index or point action after an observed window change is refused until `get_window_state` reads that window again. With the loop guard on, a third identical action after two unchanged verdicts is refused, and a session stops at 100 observed actions. Both guards use driver read-backs and return plain error results.

The other off-by-default switches are `verifyComputerTyping`, `verifyComputerScroll`, `anchorComputerTargets`, `wrapComputerScreenData`, and `guideComputerUse`. Typing compares a non-secret field inside the bridge without echoing the value; a secure or unknown field is not read back. Scrolling tries a focused scroll area and a page key only after an unchanged first scroll. Anchoring suggests a new index and token in a stale refusal without acting on it. The screen-data wrapper marks screen text as data and removes the value of any secure field or field named for a secret (password, card number, code), keeping what ordinary fields hold. Benchmark task validation, pure end-state scorers, and report rendering are under `bench/`.

Electron remains responsible for starting the native driver daemon. On macOS, the driver's permission attribution depends on Electron being its responsible process. The server receives a connection only through Electron's private parent port, and the service receives a control token only through its environment when the server launches it. No local network listener is exposed by this service.

## Checks added since

Each is off unless its switch is `true` in `config.json`; none changes what the driver is asked to do except by refusing a call or doing a read for itself.

| Switch | What it does |
| --- | --- |
| `showComputerPointer` | Turns the driver's own cursor on once per session and gives it a glide the person can follow. A driver with no cursor costs the task nothing. |
| `confirmComputerFinalActions` | Before a call that might press something that cannot be undone (send, pay, delete, post), the person is asked once on a card with only Allow once or Deny. The server's control broker decides; the bridge only adds the tool, a fingerprint of the exact call and a cleaned label to its existing check. An approval is for that call, that turn, once, for five minutes; a refusal holds for the turn. Same word list as saved steps. A target it cannot identify, in a window that shows a final action or one it never read, is asked about too. |
| `reportComputerEvidence` | Counts actions, verdicts, held-back calls and the reads the checks add, posts the totals as actions finish, and writes one plain line in the transcript when the turn lets go of the computer. |
| `holdDeclinedSignIn` | A bot cannot ask again to sign in to a site the person already declined for the same request. |

`threat-model.md` is the threat model these were written against, with the limits stated.

## Benchmark

`bench/` runs a pack of 17 deterministic tasks through the real service and pipeline against a fake desktop (`bench/desktop.ts`), once with no checks and once with all of them. The real final-action consent stands in for the server's broker and a scripted person answers its cards. Run it with `pnpm bench:computer`; reports go to `evals/reports/computer/`. It measures whether the checks change outcomes on scripted agents, never a model, so no number from it is a model's success rate. Recipe and limits: `docs/verification/computer-bench.md`.

