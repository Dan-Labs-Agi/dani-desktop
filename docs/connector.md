# Connector architecture and context

`nodecode` (the Common Lisp agent) doesn't talk to chat platforms itself. Each platform is a separate **"cell"** in `nodecode-ai/cells`, pinned by commit in `cells/bundle.json`:

```json
"channels/discord":  "rooms/nodecode-channel-discord",
"channels/telegram": "rooms/nodecode-channel-telegram",
"channels/slack":    "rooms/nodecode-channel-slack",
```

All four (plus WhatsApp, which isn't in the default bundle) sit on one shared library, `rooms/nodecode-channel-kit`. The adapter is thin — it only owns transport, auth and the platform's REST calls. Everything about "context" lives in the kit.

## The three steps every platform goes through

```
platform event  →  normalized "candidate"  →  room session (durable log)  →  forked "lane" per ask  →  model
```

**1. Ingest** — the platform's own transport. Each adapter just opens a different pipe:

| Platform | Transport | How it learns of a message | Can it read history? |
|---|---|---|---|
| Discord | Gateway websocket (op 2 IDENTIFY / 6 RESUME / 1 heartbeat, zlib) | `MESSAGE_CREATE` dispatch, gated by `intents` | Yes — `GET /channels/{id}/messages?limit=20` |
| Telegram | `getUpdates` long poll (2 s window) | message / edited_message / callback_query / message_reaction | **No** — Bot API forbids it |
| Slack | Socket Mode websocket (`xapp-` token) | Events API envelopes over the socket | Yes — `conversations.history` / `conversations.replies` |
| WhatsApp | `whatsmeow` Go driver as a **linked device** | newline-delimited JSON-RPC over stdin/stdout | Only what the device saw, via a `history` op |

Discord's socket is a pure state machine (`gateway.lisp`), with I/O in the adapter; the wire reducer is testable without a network:

```lisp
(defparameter +op-heartbeat+ 1)
(defparameter +op-identify+ 2)
(defparameter +op-resume+ 6)
(defparameter +op-hello+ 10)
```

WhatsApp is the odd one: the Lisp side spawns a Go binary and speaks one JSON object per line. That binary holds the account's keys in `~/.nodecode/channels/whatsapp/<session>.db`, so no public URL, no Meta app, no webhook.

**2. Normalize** — every message becomes one hash table with a fixed shape, so the kit never sees platform specifics. Telegram's mapping (`poll.lisp:116`):

```lisp
(nlk:json-object
 "text"    (or (nlk:json-value message :string "text")
               (nlk:json-value message :string "caption") "")
 "attachments" (telegram-message-attachments message)
 "reply"   (and ref (nlk:json-object "id" ... "user_id" ... "text" ...))
 "source"
 (nlk:json-object
  "platform" "telegram"
  "chat_kind" chat-kind          ; thread | group | direct_message | channel
  "channel_id" chat-id
  "thread_id" thread-id
  "user_id" ...
  "message_id" ...
  "reply_to_message_id" (and ref (number-string (gethash "message_id" ref)))
  "addressed" (and ref (reply-to-bot-p message bot-user-id bot-username))
  "sent_ms" ...
  "is_bot" ...))
```

That `reply_to_message_id` is the single most important field. Telegram has no threads, Slack has threads but Discord has both, WhatsApp has neither — so **the reply gesture is the universal branch structure**, and each adapter fills the same slot from whatever its platform offers (Telegram `reply_to_message`, WhatsApp `quote`, Slack `thread_ts`, Discord `message_reference`). Telegram goes further and ships the replied-to message's *text* inside the update, which the adapter hands over as the `"reply"` object; Slack does the same with a `conversations.replies?limit=1` read for the thread root (`adapter.lisp:195`).

**3. Admit** — one gate, `handle-candidate` (`kit/host.lisp:4328`). The outcome is one of three:

```lisp
(:reject  ...)                    ; allowlist / intents / DM policy
(:observe ...)                    ; someone else's chatter → context
(:answer  ...)                    ; → answer-message → new lane or steer
```

## Where the context actually accumulates: rooms and lanes

This is the part that answers your question. `kit/room.lisp` header:

> A conversation surface — a Discord channel, a Telegram chat — is a **ROOM**: one durable session holding the shared record of what it has said and been told. **The room never runs a turn.** Every ask forks a **LANE** from the room's current head, runs there, and writes its settled exchange back into the room as one turn.

So a channel/thread/DM maps to a persistent session in nodecode's store, and the *model's* context is that session's log composed through fork lineage. Nodecode, not the adapter, does the composition (`src/engine/context.lisp:88`):

```lisp
(defun collect-visible-session-events (session-id &optional (after 0))
  (let ((visible-set (nlk:session-visible-turn-set session-id)))
    (nconc
     ;; an ancestor's own read stops at its anchor
     (loop for (ancestor nil anchor-position) in (nlk:session-lineage session-id)
           when (< after anchor-position)
             nconc (visible (nlk:events :session-id ancestor :after after
                                        :before (1+ anchor-position))))
     (visible (collect-session-events session-id after)))))
```

The fork anchor is frozen at creation, so a lane sees everything the room has said **before** it arrived but nothing from sibling lanes running beside it — which is exactly how two people talking over each other in a channel behaves. When a turn settles, the exchange is folded back in (`kit/room.lisp`, `write-back`), and the room's head advances so the next ask forks above it:

```lisp
(nlk:record-exchange-turn room prompt answer)
(when (and parent (not (equal parent room)))
  (nlk:record-exchange-turn parent prompt answer))
```

A thread's room forks the channel's room, and its exchanges are also written to the parent channel's record — so a later thread in that channel sees earlier threads' conversations, and `lane-thread-note` tells the model where its own thread begins in that history so it doesn't mistakenly resume old work.

### Ambient messages — context that wasn't addressed to the bot

The clever bit. Messages in the channel that don't mention the bot can't be their own turn (a turn is one user message + one assistant message; consecutive user messages break strict chat templates). So they're buffered as text and ride into the next ask's prompt:

```lisp
(defun observe-candidate (host candidate)
  "Room chatter that was not addressed to us: buffered as context for the
next ask."
  (let* ((line (host-speaker-line host candidate :cap +room-ambient-line-cap+ ...)))
    (note-ambient host (room-session-id ...) line)))
```

Capped at 40 lines × 300 chars, drained (not copied) when an ask takes them, and prepended verbatim to the ask — which means the room's write-back is exactly what the model read, one text, two readers (`compose-prompt`):

```lisp
(dolist (entry ambient) (write-string line out) ...)
(write-string ask-line out)
```

Every line has a fixed speaker format, so the model can tell who said what and what it replied to:

```
<name> [m<message-id> u<user-id> r<replied-to-id>]: <what they said>
```

An unanswered reply is "line Continues" — `reply-context-line` renders it as `↳ <who> [m<id>]: ...`, so a quoted message is context, not a second prompt.

### The reply gesture decides the topology

`answer-message` (`kit/host.lisp:3431`), in its own words:

```
a reply to a RUNNING lane  -> steer it, no new slot
a reply to a SETTLED lane  -> its next turn, through the gate (whole tool trace still in context)
anything else              -> a new lane forked at the room's head
```

A DM or a thread the bot already takes part in is "one conversation", so no reply gesture is needed — `conversation-lane` returns the live lane. A reaction is never a trigger; it becomes one line of chatter on the next ask.

### Bounding and catch-up

- `room_tokens` (default 40000 estimated tokens) — past it the older half is dropped from what lanes see; the log keeps it and `(recall-entry N)` reads it back word for word (`bound-room` → `nle:evict-session-context`).
- `catch_up_minutes` (default 60) — after downtime each adapter replays what it missed: Discord and Slack actually fetch (`/channels/{id}/messages?before=` / `conversations.history`), Telegram drains the 24 h `getUpdates` backlog, WhatsApp replays what the phone synced. Late messages are labelled in the prompt: `(sent 12 minutes ago, while you were offline)`.

## On-demand reads: the model can pull more itself

Besides the room log, each channel injects an API "primer" into the lane's harness section, and the agent's one `eval` tool can call the platform directly with the bot's token. So when the room record isn't enough, it does its own lookups:

- Discord: `GET /channels/<id>/messages?limit=20`, threads, pins, members
- Slack: `GET /conversations.history?channel=…&limit=20`, `conversations.replies`
- WhatsApp: `history (:chat <jid> :limit N :before_ms T)`, `group_info`, `resolve`
- Telegram: explicitly none — *"Bots cannot read chat history — the ids in the user lines are the handles you have."*

## Files and voice

Attachments are a first-class part of the same pipeline (`kit/host.lisp`, "inbound attachments"): each candidate carries files **by reference** (a URL, or a thunk using the adapter's credential), fetched at admission. Images become base64 `(media-type . base64)` parts; recordings are transcribed locally by default; text files up to 100 KB are read in whole; anything else up to 32 MB is saved to `~/.nodecode/channel-files/` and its path put in the prompt for the agent's own tools to open.

---

**Bottom line:** context doesn't come from scraping the chat. Each platform's adapter normalizes an event into a candidate, the kit maps the channel/thread/DM to a durable nodecode session, every ask forks a lane off that session's current head so the full prior conversation is composed from the event log, non-addressed chatter is buffered and rides the next prompt, and the settled exchange is written back. The reply/quote gesture is what stitches it all together across platforms that have no threads — and the agent can always go read more from the platform API itself, except on Telegram, which forbids it.
