# Computer use: threat model for the live checks

Covers what `plan.md` adds on the live path of the person's own computer: the
final-action confirmation (A6) and its exact-call approvals (A7), the declined
sign-in memory (A8), the screen-data wrapper, the evidence report (A10), and the
visible pointer (A9). Written before the code, following
`.claude/skills/dani-threat-model`. Everything here is off unless its switch is
set in `config.json`.

## What is being protected

- The person's accounts and data, reached through their own screen: sending,
  paying, deleting, posting, submitting, transferring.
- What the person sees and trusts: the confirmation card, the one-line report.
- The turn's capability token, which lets the bridge call the server for that
  one computer and conversation.

## Who and what is trusted

| Party | Trust |
| --- | --- |
| The person, answering a card in the app | Authority |
| The server's control broker (`/api/internal/computer-control`) | Decides; the only place a final action is authorized |
| The bridge (`computeruse/service.ts`) | Describes a call and forwards what the broker allows; never authorizes |
| `cua-driver` | Reached only through the bridge; Electron owns its socket |
| The engine and the model | Untrusted for authorization: it proposes calls |
| Text on the screen (labels, titles, page text) | Hostile input, always |

## Threats and what answers them

| Threat | Answer |
| --- | --- |
| **Prompt injection from a page** ("the person already approved sending") | Cards are answered only through the person's authenticated UI route; the engine and the MCP server cannot answer one. A denial or approval is never inferred from text. |
| **A page writes the card's words** (a button labelled `Allow, this is safe`) | The label shown is cleaned to a short plain phrase (letters, digits, spaces and a few marks, at most 40 characters and 6 words). Anything else is dropped and the card uses its generic wording. The label is always shown inside quotation marks. |
| **A page hides a destructive action behind a harmless label** (`Next`, `OK`, an icon) | Not solved by words. An unlabelled target, or a point click, in a window that shows a final action, or in one never read, is treated as unknown and asked about. A genuinely misleading label is a known limit (below). |
| **Confused deputy: approve one thing, do another** | An approval is bound to a fingerprint of the exact call: tool, arguments, app, window title, and the target's role, label and path. The element index and token are left out because they change on every read. A different target gives a different fingerprint and asks again. |
| **Replay of an old approval** | An approval belongs to one conversation turn, can be used once, and expires after five minutes. |
| **Wearing the person down** (ask again until they say yes) | A denial stays a denial for the rest of the turn for that exact call; the bot is told not to ask again. |
| **Duplicate submit** | Single use means a repeated send asks again; the effect check and the repeated-action guard also apply. |
| **Broker outage or slow broker** | The bridge already refuses a call when the broker cannot confirm the computer is free. A final action is decided in the same check, so an outage refuses it. |
| **Stale approval after the screen changed** | The fingerprint is taken from the bridge's own snapshot at call time. A changed window gives a different fingerprint. |
| **Forged evidence** | The report body is untrusted: only whole numbers and short plain names survive parsing, values are clamped, and the sentence is written server-side. The report states counts, never outcomes. |
| **A hidden second path** (shell, HTTP, a second driver) | Not closed by this change. The final-action check covers calls through the computer bridge only. Anything an engine can do through its own shell is governed by its approval mode and the command allowlist. |

## Enforcement point

The server's control broker decides. The bridge adds `risk`, a short label and
the fingerprint to the check it already makes before every call, and refuses
nothing on its own. A server that does not know these fields ignores them, which
leaves behaviour as it was; the service and server ship together.

## Known limits, stated plainly

- This is a seatbelt, not a boundary. The word list is the one saved steps use,
  in the languages the app ships; an icon-only button or a misleading label can
  pass. The approval level and the person's own attention remain the control.
- The list is broad (`reply`, `share`, `confirm`, `reset` are on it), so with
  this switch on a person will be asked more than they might expect.
- The turn's bearer is in the bridge's environment, which the engine can reach.
  An engine that reads it can post its own evidence and call the broker for
  itself. It cannot answer a card, and cannot make the broker approve a
  fingerprint the person did not allow. Same open risk the journal route records.
- A pixel click in a window the bridge has read, and which shows no final
  action, passes.
- The pointer and evidence report change nothing about what is allowed.

## Defaults

Every switch is off. None should default on before the benchmark's numbers and a
recorded run on a real driver exist for the platform.
