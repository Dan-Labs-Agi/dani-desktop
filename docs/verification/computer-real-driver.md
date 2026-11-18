# The computer-use checks against the real Windows driver

One run of the real `cua-driver` (0.28.2, the build staged by `pnpm build:cua:win`) through the real computer service
with the checks on, against a window the script opens itself. It is the plan's A0: the fixture benchmark cannot say
what the real driver answers.

## What it does, and what it will not do

`computeruse/bench/real/windows-baseline.ts` opens `fixture-window.ps1`, a small window with a text field, a secret
field and three buttons (one changes its own label, one writes a file, one writes a file and is a final action). It
then drives it through the service:

- It acts only on a window owned by the fixture's own process, and stops if the driver lists none.
- Its default phases use background delivery (`delivery_mode: "background"`), which the driver performs as a UIA Invoke:
  no mouse movement, no keystrokes. The window shows without taking focus.
- The `foreground` phase uses the person's real mouse and keyboard, so it runs only when named, never as part of `all`.
  The window shows a banner saying so, the text typed is `hello`, and it never retries a refused call.
- It stops everything it started. A driver daemon that was already running is left alone; one it started is stopped.
- The final-action broker is a stub that holds the call back, so `Send` never runs.

```sh
pnpm build:cua:win
node --experimental-strip-types computeruse/bench/real/windows-baseline.ts --phase all
```

Phases are `read` (read only), `checked` (acts on the fixture), `stale` (a token from an earlier read), `all` (those
three), and `foreground` (real mouse and keyboard; run it deliberately).
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

## Foreground delivery

Run separately (`--phase foreground`), against the same window with a banner and a Quit button that closes it.

| Question | Answer |
| --- | --- |
| Foreground click | The driver did a `SendInput` click at the button's screen position and the label changed. |
| Raw foreground `type_text "hello"` | The driver typed 5 characters and the field held `hello`. The one-burst problem the Windows pacing was written for (later characters landing in place of earlier ones) did not appear in this window. |
| The same through the Windows pacing | The driver's answer was "Typed 5 char(s) … one character at a time" and the field held `hello`, so the stage engaged on 0.28.2. Raw typing worked here too, so this window cannot show that the pacing helps. The code attributes the fault to modern Notepad. |
| Click that closes its window (`Quit`) | The window closed, and the driver gave the answer the sent-click stage exists for ("not foreground after the click"). The bot was told the click was sent and not confirmed, and the fixture really had closed. |

It also showed that answer carrying a second note, "the window could not be read back … whether it landed is unknown",
which contradicted the first. A click already reported as sent and unconfirmed now gets no second note, and its
verdict is still counted.

## What it found in this repo

- Typing verification looked the field up by element token, and every read mints new tokens, so a token-addressed
  `set_value` always read back "unreadable". Fixed; it now finds the field by what it is.
- A refused typing call lost the driver's explanation. Fixed.
- `elementPath` returns null for every element in this read, so saved steps cannot identify a target and the
  re-anchor stage cannot re-find one on this driver. Not changed.

## read_window

`--phase readwindow` reads the fixture window through the service with `read_window` on. It only reads: no click, no typing.

- The driver accepts `include_screenshot: false` with `query` and `max_elements`; the answer is one text part, no picture, no structured copy.
- Every element is a line with its index and a token (`s00000002:0`) the next call can use as it stands. The answer was 1,361
  characters of JSON against 24,407 for `get_window_state` with its screenshot. The comparison is mostly the picture; the
  text alone would be nearer.
- `query: "Body"` kept the matching row and gave 331 characters.
- The checked flow, secret-value removal and tag stripping are tested on a fixture driver, not on this one: this driver held
  the card number's value back itself.

## computer_batch

`--phase batch` makes batches of two clicks on the fixture's Mark button (a toggle), then a `read_window`, with every check on.

- The first click is a UIA Invoke and reads back "changed". The second is refused: by the driver when it carries the same token
  ("element_token is stale; call get_window_state again to refresh"), and by the stale-window check when it carries the
  snapshot id and index ("The window changed since this target was chosen"). The batch stops at it and says so; Mark was
  toggled once, not twice.
- So on this driver a second element-addressed action in one batch cannot run: the read-back after the first action mints new
  tokens, and the window it changed is no longer the one the target was chosen from. That is the checks working, not a fault.
  A batch earns its place only for steps that name no element: key presses, typing into the focused field, scrolling, and a
  closing `read_window`.
- Not measured: whether a batch saves time. Nothing here times a model's round trips.

## Limits

- One run, one machine, one driver version, one small window. A large window will cost more per read; a read is cut
  off at 4 seconds.
- Foreground delivery was run once, on the same small window. A text box in a WinForms window is not the app the
  pacing was written for: modern Notepad, where the burst problem is reported, was not exercised, because launching it
  can open a tab in a Notepad the person already has and type into their document.
- macOS and Linux were not run.
- The fixture is not a real app; a real app's tree, focus behaviour and dialogs will differ.
- No model drove it. The calls were scripted.
