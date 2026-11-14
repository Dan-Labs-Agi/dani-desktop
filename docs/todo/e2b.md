# E2B integration plan

Status: proposed. E2B is not enabled by this document.

## Goal and scope

Offer an optional E2B-backed cloud environment for a bot to run code and work
with user-selected files. Preserve local and existing cloud computer choices.
E2B provides sandbox lifecycle, command and filesystem APIs; its desktop and
network capabilities must be evaluated against Dani Bot's existing computer
contract before presenting it as a full computer. See [E2B documentation](https://e2b.dev/docs)
and [security model](https://e2b.dev/security).

The current app distinguishes its agent execution boundary from computer tools:
the harness launches agent CLIs, while cloud computer access is provided through
computer tools and proxies. See [computer use](computer-use-integration.md),
`server/cloud-computer-tools.ts`, `server/computer-selection.ts`, and
`shared/cloud-computer.ts`. The cloud home's separate process sandbox is
described in [bot box](bot-box.md). An E2B computer does not automatically move
the agent CLI or the harness into E2B, and must not weaken that boundary.

## Proposed design

1. Start with a capability audit of the current computer tool, preview, file,
   approval and lifecycle contracts. Map each to supported E2B operations and
   document gaps. If screen streaming, input control, or approval semantics
   cannot be matched, ship a clearly named code-and-files sandbox instead of
   claiming full computer parity. Do not route an unsupported operation to the
   user's local computer as a fallback.
2. Add an E2B provider behind a narrow server-side adapter for create, inspect,
   execute, file transfer and stop. Extend the existing computer selection and
   tool routing only after establishing the contract; keep provider-specific
   SDK details out of shared UI types. Pin the SDK after checking its current
   Node requirements and APIs. Use a versioned, minimally provisioned template.
3. Offer explicit selection and disclose that selected files and commands leave
   the device for E2B. Copy only user-authorized files, enforce size and path
   limits, and require an explicit action to import outputs. Treat sandbox
   paths and generated files as untrusted; reject traversal and unsafe links.
   Define what is lost on stop or timeout before creating the environment.
4. Keep the E2B API key in the server's existing secret store, never in the
   renderer, logs, sandbox or packaged app. If offering centrally funded usage,
   build an authenticated, quota-enforcing backend broker; do not embed a shared
   provider key. Decide separately whether users bring their own key. Credentials
   for other services must not be copied into the sandbox by default.
5. Preserve existing per-bot access, approvals and turn ownership. Bind each
   sandbox to an authorized installation and bot; authorize every operation
   server-side. Treat network access and exposure of preview ports as explicit
   capabilities: deny private, loopback and metadata destinations and restrict
   ingress, using enforced provider controls or a suitable gateway. Validate
   those controls before enabling networked workloads.
6. Define create, running, stopping, stopped and failed states, timeouts,
   cancellation and cleanup. Handle retries and ambiguous create responses
   without leaking duplicate sandboxes; reconcile orphaned resources after a
   restart. Use provider expiration as a backstop, not the only cleanup path.
   Do not promise persistence across stop unless deliberately implemented.
7. Set per-user concurrency and duration limits, budget alerts and a hard
   spending policy before a hosted trial. Check credit eligibility, expiry,
   regions, usage rates and overage terms. Surface unavailable service, quota,
   timeout and cleanup failures in the UI without exposing secrets.

## Delivery and verification

- Prototype the adapter with a fake provider first, then exercise a dedicated
  E2B test account and short-lived sandbox. Verify template capabilities and
  regional availability against the current provider documentation.
- Test authorization across bots and installations, approval enforcement,
  file traversal, network restrictions, timeouts, concurrent starts, retries,
  cancellation, restart reconciliation and cleanup. Verify no provider key or
  user content reaches logs or client responses.
- Exercise one representative task end to end, including explicit file upload,
  execution, output review, import and sandbox destruction. Test service outage
  and quota exhaustion without falling back to local execution.
- Follow [verification guidance](verification/README.md) for server and
  conversation changes. Launch isolated fixtures with synthetic data; never
  verify mutations against the user's live app or data.
