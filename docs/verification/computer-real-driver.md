# The computer-use checks against the real Windows driver

One run of the real `cua-driver` (0.28.2, the build staged by `pnpm build:cua:win`) through the real computer service
with the checks on, against a window the script opens itself. It is the plan's A0: the fixture benchmark cannot say
what the real driver answers.

## What it does, and what it will not do

`computeruse/bench/real/windows-baseline.ts` opens `fixture-window.ps1`, a small window with a text field, a secret
field and three buttons (one changes its own label, one writes a file, one writes a file and is a final action). It
then drives it through the service:

- It acts only on a window owned by the fixture's own process, and stops if the driver lists none.
- It uses background delivery (`delivery_mode: "background"`), which the driver performs as a UIA Invoke: no mouse
  movement, no keystrokes. The window shows without taking focus.
- It never retries in foreground mode.
- It stops everything it started. A driver daemon that was already running is left alone; one it started is stopped.
- The final-action broker is a stub that holds the call back, so `Send` never runs.

```sh
pnpm build:cua:win
node --experimental-strip-types computeruse/bench/real/windows-baseline.ts --phase all
```

Phases are `read` (read only), `checked` (acts on the fixture), `stale` (a token from an earlier read), and `all`.
The report goes to `evals/reports/computer/windows-baseline.json`.

## What the real driver answered

Windows 11, cua-driver 0.28.2, one machine, one run, a window of 10 elements.

| Question | Answer |
| --- | --- |
| Does a background click act? | Yes. `Save` wrote its file (once, then twice after a second click). `Mark` changed its label. |
| Window changed (`Mark` becomes `Marked`) | Verdict "changed"; no note is added. |
| Effect outside the window (`Save` writes a file) | Verdict "unchanged"; the note says no change is normal when the effect is elsewhere. |
| `set_value` then read the field back | "matched", and the file it wrote holds the typed text. |
| Final action (`Send`) with the broker holding it | The broker saw exactly one risk query, for `Send`; the call was refused and the file was not written. The other eleven checks were ordinary. |
| Token from an earlier read | The driver refuses it: "element_token is stale; call get_window_state again to refresh". Tokens are `sNNNNNNNN:index`, and each read mints new ones. |
| Bare `element_index` | The driver refuses it: "pass element_token, or snapshot_id together with element_index". |
| Agent cursor | Enabled, glide 400 ms, dwell 300 ms. The driver rejects its own `get_agent_cursor_state` output as invalid; the values are in the rejected payload. |
| Cost of the checks | 4 reads for 4 actions, 600 ms added in all: about 150 ms per read (130 to 197 ms). |
| Shape of a read | Indexes start at 0; roles are `Edit`, `Button`, `TitleBar`; no window root element; top-level controls have depth 1 and no parent. `elements_complete` is false although 10 of 10 elements were returned. |
| Secret field | No value returned by the driver. Its role is `Edit`, so only its label marks it. |

## What it found in this repo

- Typing verification looked the field up by element token, and every read mints new tokens, so a token-addressed
  `set_value` always read back "unreadable". Fixed; it now finds the field by what it is.
- A refused typing call lost the driver's explanation. Fixed.
- `elementPath` returns null for every element in this read, so saved steps cannot identify a target and the
  re-anchor stage cannot re-find one on this driver. Not changed.

## Limits

- One run, one machine, one driver version, one small window. A large window will cost more per read; a read is cut
  off at 4 seconds.
- Background delivery only. Foreground delivery, and with it the Windows sent-click answer and one-character-at-a-time
  typing, were not exercised.
- macOS and Linux were not run.
- The fixture is not a real app; a real app's tree, focus behaviour and dialogs will differ.
- No model drove it. The calls were scripted.
