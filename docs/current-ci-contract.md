# Current Desktop CI contract

The source of truth is `.github/workflows/ci.yml`, not the imported upstream
job-selection description in `docs/ci.md`. This note records the current
contract. It does not change triggers, start runs, or authorize a release.

## Adopted automation

- Pull requests, pushes to `main` and `prod`, and manual runs use the portable
  macOS/Linux/Windows typecheck and test matrix. Required checks fail the job.
- Linux validates locales, builds the full product, packages it, and checks
  installation, in-place upgrade and lifecycle behavior.
- Optional iOS, Android and SDD jobs run only when checkout contains their
  source trees. The November 3 fixes moved detection into a checkout job
  because `hashFiles` cannot inspect files at job-level evaluation time.
- Typechecking uses a 7 GB heap and the test job has a 30-minute limit,
  matching the November 3 fixes. A timeout is a failure, not test completion.
- The known Windows Electron sandbox canary alone is advisory. It remains
  separate from required tests and does not disable Chromium's sandbox.
- CI is read-only. Existing automatic CI can use caches and failure artifacts.
  The three `verify-main-*` workflows are different: manual, read-only,
  no artifact uploads or caches, with disposable native installation checks.
- The release workflow still builds packages on branch pushes. Its assembler
  can create a draft only for a manual or version-tag run, and refuses to
  replace a published release. This is not a CI-success or shipping guarantee.

## Not adopted

The imported upstream `ci-scope` matrix, Boat routing, nightly lane,
`ci-stop-closed.yml`, aggregate `CI` gate and upstream release-CI orchestration
are not wired into this repository's workflow. Their helper modules may still
exist in the tree. Tests must not assert that these jobs run when they do not.
Restoring them would be an automation change, not a test repair.

## Regression coverage and limits

`scripts/ci-workflow.test.ts` checks the adopted triggers, platform matrix,
blocking checks, optional-source detection, least privilege, action pins,
manual verification storage limits and existing draft-release restrictions.
Mutation cases reject omitted, conditional or advisory required checks.
The delegated-approval receipt regression is retained.

These structural tests do not prove native rendering, real provider replies,
installation on a user's machine, signing/notarization, or release readiness.
A green test cannot replace those checks. Existing broader failures and
unverified areas must still be reported.

Provenance inspected: `2579b4747` (optional native jobs), `809a35475`
(checkout detection), `42c1502e9` (heap and optional SDD detection),
`cad9cbd5f` (test timeout), and `2de6f3caa` (draft publication hold).
