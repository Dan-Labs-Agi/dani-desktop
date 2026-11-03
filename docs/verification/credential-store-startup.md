# Credential store at startup (macOS upgrade-over-data)

Measured evidence from the upgrade-over-data CI probes (install-timing-probe
against the published v0.1.58 data shape on macos-15-intel runners).

## Measured facts

- Both the published and branch builds are unsigned: `codesign -dv` reports
  "code object is not signed at all" for each.
- Electron's OSCrypt keychain item is named **"dani-desktop Safe Storage"**
  (from the package name, not the product name). Old and new builds share the
  item name.
- On upgrade, the new binary's signature does not match the item's ACL, so
  macOS shows a SecurityAgent dialog. Because the builds are unsigned, the
  dialog requires the login keychain **password** ("The authenticity of
  'Dani Bot' cannot be verified"), not just a click. Captured on-screen in the
  runner's GUI session (run 41622137103, artifact install-probe-upgrade-mac-intel,
  screen.png).
- While the dialog waits, any OS credential call (read, write, or the
  availability probe itself) stays pending indefinitely. A CI runner has nobody
  to answer the dialog, so startup used to park before the server forked and
  never answered health (probe terminal=budget-exhausted, firstHealth=null).

## Behavior under test

- Every OS credential call - availability probe, decrypt, encrypt - runs with
  a bounded wait (default 15s, OMB_CREDENTIAL_CALL_TIMEOUT_MS). A timed-out
  call ends as "unavailable"; the orphaned OS promise is never applied late.
- Reads and writes are serialized through one coordinator; timed-out writes
  throw before any filesystem operation, and a failed write removes only its
  own attempt-unique temp file.
- "Unavailable" is never reported as "empty": a fresh install over real data
  cannot be registered from an unread store.
- Startup continues without the credential store; the UI offers an explicit
  retry, and after a successful retry it offers a user-initiated relaunch to
  apply saved sign-ins. No automatic restart, no keychain deletion, no
  plaintext fallback.

## Not established by this evidence (do not claim)

- That answering the dialog on an interactive Mac completes startup and
  recovers access. Expected from the mechanism, not measured.
- How often the prompt recurs for real users across updates (expected: each
  update while builds remain unsigned; not measured).
- That a future stable signing identity satisfies an existing item's ACL
  without one more prompt. Unverified.

## Healthy references

- Windows x64 upgrade-over-data: cold start ready in 5075ms, 63/63
  pre-existing files preserved byte-identical (run 41622137103).
