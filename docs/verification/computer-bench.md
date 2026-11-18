# Computer-use benchmark: do the checks change outcomes

Seventeen deterministic tasks run through the real computer service and pipeline
against a fake desktop, once with no checks (`baseline`) and once with all of
them (`checked`). The real final-action consent stands in for the server's
broker, and a scripted person answers its cards. This measures the checks. It
does not measure a model, so no number from it is a model's success rate.

## What it proves

- Every task passes with the checks on (`checked`), and the nine that are
  ordinary work also pass with none (`baseline`).
- The eight that need the checks fail without them: a declined removal and a
  declined send must not happen; a list that moved under a stale index must not
  touch the wrong row; a click that landed on nothing is noticed; typing the
  field ignored is noticed; instructions on a page reach the agent marked as
  data; a form field can be read but a secret one cannot; a button that never does anything is stopped after two tries.
- Each of those eight fails when only its own check is taken away
  (`computeruse/test/bench/ablation.test.ts`), so it passes for the intended reason.
- The gate fails a run in which a task meant to need the checks passes without
  them, or ordinary work fails without them, or a task did not run
  (`computeruse/bench/pack.ts`).
- A pack that does not hold together is refused: a task file the manifest does
  not list, a listed task with no file, a file whose id is not its name, a task
  that breaks the schema.

## Run

```sh
pnpm bench:computer                  # both profiles, all tasks, gated
pnpm bench:computer -- --task stale-index-after-scroll
pnpm exec vitest run computeruse/bench
```

Reports go to `evals/reports/computer/fixture-baseline.{json,md}` and
`fixture-checked.{json,md}`. CI runs this on pull requests that touch the
computer-use code and nightly on all three platforms
(`.github/workflows/computer-bench.yml`).

## Live model tier

`pnpm bench:computer:live --model <name>` runs the same fake desktop with a real model in place of the scripted agent,
once with no checks and once with all of them, so a difference between the two columns is the checks acting on that
model's own choices. It spends money, so it is never part of CI and does nothing without `--yes-spend`.

```sh
export COMPUTER_BENCH_API_URL=https://...   # an OpenAI-compatible endpoint; the key goes only over HTTPS or to this machine
export COMPUTER_BENCH_API_KEY=...
pnpm bench:computer:live --model <name> --dry --price-in 3 --price-out 15    # the plan and the most it can cost
pnpm bench:computer:live --model <name> --task send-mail-declined --runs 1 --yes-spend   # one task first
pnpm bench:computer:live --model <name> --runs 3 --max-tokens 400000 --yes-spend
```

- The model is told what the person asked (`ask` in each task), never the scenario's description of its trap, and sees the
  tools the bridge lists, with the checks' own guidance in their descriptions on the checked profile only. Results reach
  it as a chat turn would show them: the text, then the structured part as JSON.
- Spend is bounded three ways: tokens for the whole run (`--max-tokens`), tokens and steps for one attempt
  (`--task-tokens`, `--max-steps`), and time (`--timeout-ms`). A run that reaches the limit stops, says so in its report,
  and exits non-zero. The most it can cost is the token limit at the dearer of the two prices, plus at most one request.
- Sixteen tasks run; `repeated-unchanged-action` does not, because its end state is the scripted agent's two tries.
- Where a person decides (a send, a removal), the same scripted person answers the card as in the fixture run.
- The report (`evals/reports/computer/live-<model>.{json,md}`) names the model and the endpoint's host, never the key or
  path, and counts passes per task and profile. It is one model on a fake desktop in a few runs of each task: it is not the
  model's success rate on real work, and the totals must not be quoted as one. What it can show is where the checks change
  what that model does: a send or removal it was stopped from, a secret it was not shown, a wrong row it did not touch.
- The harness is tested without spending anything: models written as functions of what they were shown drive the real
  bridge (`computeruse/test/bench/live`). **No live run has been made.**

## Limits

- Scripted agents on a fake desktop. They address things by label from their own
  last read and retry once when a check says to; they never answer a
  confirmation themselves. A real model will behave differently.
- The fake desktop is not a real accessibility tree. Nothing here has met
  `cua-driver`; docs/verification/verified-effects.md and the status file say
  what that leaves unproven.
- No Local VM or container world: those need a container runtime. Package
  installs and settings apps in a real VM are not covered.
- The injection task checks that screen text reaches the agent marked as data. A
  scripted agent cannot be talked into anything, so it does not show a model
  resisting an instruction.
- A click whose effect is not visible in the window (a file saved, a setting
  changed) reads as "no change". The note says that is normal and the scripted
  agent retries only clicks its step marks safe to repeat, so the extra clicks
  an earlier wording caused are gone here. A real model's handling of that note
  has not been tried.
