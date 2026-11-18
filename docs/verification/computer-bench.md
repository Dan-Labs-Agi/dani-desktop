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
