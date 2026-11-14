# Sentry integration plan

Status: proposed. This document describes work to implement; it does not mean
Sentry is configured or collecting events.

## Goal and scope

Find crashes and actionable failures in Dani Bot's Electron main process,
renderer, and Node harness, with enough release information to diagnose them.
Start with error reporting; defer performance tracing, session replay, logs,
attachments and profiling until separately justified and reviewed.

Dani Bot is local-first: transcripts, keys and events normally stay on the
user's machine. Sending diagnostics to Sentry changes that boundary. Make
reporting opt-in, off by default, explain the destination and data sent before
enabling it, and provide a persistent switch to turn it off. Do not queue
events while disabled; clear any SDK-owned pending events on revocation.
Failure to initialize or reach Sentry must not block app startup or bot work.

## Implementation

1. Create separate Sentry projects or environments for development and
   production. Check the credit's eligibility, expiration, retention and
   overage settings. Configure server-side data scrubbing and quotas.
2. Evaluate the current [Sentry Electron SDK documentation](https://docs.sentry.io/platforms/javascript/guides/electron/)
   and Node SDK against the repository's pinned Electron, Node and packaging
   setup. Pin compatible dependencies. Electron starts at `electron/main.mjs`;
   the server is a separate Node process and needs its own initialization and
   consent state. Ensure renderer events are not reported twice.
3. Add a diagnostics preference through the existing settings and preload
   contracts. Persist consent locally, propagate changes to each running
   process, and initialize or disable reporting accordingly. Handle startup
   crashes before consent by keeping reporting disabled. A self-hosted server
   needs its own explicit operator configuration; do not infer consent from a
   packaged desktop setting.
4. Use a shared allowlist for event fields and sanitize at the last outbound
   boundary in every process. Send release, platform, process, and a bounded
   error category and stack only after verifying they contain no sensitive
   values. Drop exception messages, URLs, file paths, breadcrumbs, request
   data, user identifiers and arbitrary context unless explicitly sanitized.
   Never send prompts, model output, screenshots, files, credentials, tokens,
   environment variables, command output or connected-app data. Disable
   default integrations that violate this policy; do not rely on scrubbing
   alone. Test native crash reports separately before enabling them.
5. Set release identifiers consistently with packaged builds. Upload source
   maps privately in CI using a CI-only token; do not ship that token or expose
   source maps publicly. Verify symbolication for each process and platform.
   A Sentry DSN is an ingestion address, not a secret; keep administrative
   tokens out of the application.
6. Add rate limits and deduplication, and report failures without recursive
   error capture. Document the privacy notice, retention, and opt-out behavior.

## Acceptance and verification

- With reporting off, no Sentry request occurs, including at startup or after
  restart. Enabling it sends a deliberately generated sanitized fixture error;
  disabling it stops future sends and removes pending SDK-owned events.
- Inspect captured transport payloads containing seeded secrets, paths,
  prompts and URLs; none may appear, including in stacks and metadata. Test
  renderer, main and server independently and ensure one event per failure.
- Offline operation and SDK initialization failure do not disrupt the app.
  Confirm source maps resolve a packaged build's fixture stack.
- Follow [verification guidance](verification/README.md): use isolated fixture
  data and a test Sentry project or mock transport, never the user's live app or
  data. Verify packaged builds and consent persistence on supported platforms.
