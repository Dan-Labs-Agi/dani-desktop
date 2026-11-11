# Verified effects: what an action on this computer actually changed

An action a bot takes on this computer is answered by what reading that window
back shows it did, not by the driver's word that it sent the input. Off unless
`features.verifyComputerEffects` is `true` in `config.json`: it costs two extra
driver reads per action and has not been run against a real driver.

## Why

cua-driver 0.28.2 answers an action with `structuredContent.effect`, but its own
word covers only the input it sent. A click that reaches the window and lands on
nothing reads exactly like one that worked, and a foreground click whose
after-check failed reads `unverifiable`
([`server/unconfirmed-click.ts`](../../server/unconfirmed-click.ts)) even though
the click went out. A bot that believes either one builds the next thirty steps
on an effect that never happened.

## What it proves

- Each verified action reads the window before it acts and again afterwards,
  and compares the two: `get_window_state`, the action, `get_window_state`.
- When the window moved, the driver's own result is the whole answer and nothing
  is added.
- When the window did not move, the bot is told so in plain words and told to
  read the window and decide from what it shows. It is never told to send the
  action again: a second click pays twice, and whether the first one acted is
  the open question.
- When the read-back does not answer, the verdict is `unobserved`, never
  "nothing happened". A read-back that never returns is bounded at 4 s and the
  action is still reported as sent.
- The fingerprint covers app name, window title and the element tree's roles,
  labels and shape. What a field holds never reaches it, so a verdict about a
  typed password or card number carries neither
  ([`server/saved-steps/driver-wire.ts`](../../server/saved-steps/driver-wire.ts)).
- An action the driver refused or failed is answered as it came, with no
  read-back: it sent nothing.
- An action with no `pid` and `window_id` to address, and every observation
  tool, goes to the driver untouched.
- On Windows the sent-click answer and one-character-at-a-time typing still
  apply, and the verdict is added to them.
- With the switch off, `OMB_COMPUTER_VERIFY` is `0` and no read-back is made,
  including when saved-steps journalling is on.

## Run

Unit and relay checks:

```sh
pnpm exec vitest run server/computer-effect.test.ts server/local-computer-guidance.test.ts server/local-computer.test.ts server/local-computer-proxy.test.ts server/unconfirmed-click.test.ts server/config.test.ts
```

## Limits

Not verified: a real `cua-driver` on a real desktop. These checks drive a fake
child through the bridge's own relay seam, so they prove the loop's shape, its
bounds and its words, not what the driver answers for a real click on a real
window. The latency of two extra accessibility reads per action is unmeasured;
[`docs/verification/computer-wait.md`](computer-wait.md) and
`pnpm bench:observation` are where that belongs before the switch defaults on.
Per [`.claude/skills/dani-integration-cua`](../../.claude/skills/dani-integration-cua/SKILL.md),
this feature is not done until it is demonstrated on an actual target platform,
Windows first.
