# Current-source local Hermes app

This path is separate from an already running packaged DaniBot. It does not stop,
update, migrate, or share data with the app on ports 8799/8800.

## Prerequisites and launch

Use Node 24+, the checkout's installed pnpm dependencies, and the existing managed
Hermes 0.21.3 installation at `~/.hermes/hermes-agent/venv/bin/hermes`. No install,
global package patch, or PATH Hermes upgrade is performed. This launcher is
qualified for the local macOS/POSIX layout, not Windows.

```sh
# Metadata only: prepare the isolated profile/workspace; no model calls:
node scripts/start-local-hermes.mjs --prepare-only

# ONLY after native provider sign-in and explicit approval of this probe's budget:
node scripts/start-local-hermes.mjs --qualify-provider

# After successful qualification and explicit enablement of the local Hermes instance:
# serve the current source UI/backend (keep this process running):
node scripts/start-local-hermes.mjs
```

Open **http://127.0.0.1:8811**. The backend uses **8812**, and its webhook listener
uses **8813**. All three ports must be free; the launcher refuses occupied ports
rather than killing or reusing another service. Ctrl-C stops only its own child
processes. A supervisor can run this same foreground command as a managed service.

Startup uses the existing app-owned verified browser bundle under
`dist-native/browser/<platform>-<arch>` and the existing stage helper when needed.
It passes the exact verified engine/Chromium paths to its backend; it does not
install/update a global Hermes/Python package or alter another app's browser.

The persistent app workspace is `~/.danibot-local`. It is explicitly created
before server startup, preventing the server's missing-directory legacy migration
from moving another workspace. Existing local-workspace config is never replaced.

The native profile is `~/.hermes/profiles/dani-local`. On first use the launcher
runs supported `profile create dani-local --clone-from default --no-alias` with an
explicit default Hermes home. It never calls `profile use`, changes the sticky
profile, or clones messaging channels/history. Config and credentials stay in this
native profile, not in app config or command arguments. Profile/workspace files
are owner-private. Subsequent launches reuse the same profile and conversation
state; native configuration changes must be made explicitly in that profile.

The app selects `hermes-default`: the explicitly selected provider/model in the
isolated native profile stays authoritative. Use Hermes' supported native auth and
model-selection commands with `HERMES_HOME=~/.hermes/profiles/dani-local`; do not put
keys in Dani config, shell arguments, chat, or logs. Selecting a new compatible
provider is an explicit operator action, never an automatic paid/model fallback.

The previous loopback **4187** route is **not tool-compatible**: it runs another
agent and discards the caller's tool schema/choice. Catalog membership and ordinary
chat replies did not prove that Hermes could execute its tools. The launcher now
rejects that route before qualification or startup, leaves its original process
and global native profile untouched, and does not emulate a restricted client.

## Metadata, qualification, and autonomy are different

`--prepare-only` and native `--runtime-info` are metadata-only. They use supported
native runtime resolution and report actual configured/resolved provider, model,
sanitized endpoint, API mode, imported source and Python/distribution version.
They never request `/models`, send OAuth credentials to the old proxy, or infer
tool capability from a model catalog. `local-runtime.json` contains only safe
runtime metadata and a `providerQualified` boolean; it cannot authorize startup.

`--qualify-provider` is an explicit real-model operation, not a startup probe.
It uses the installed native AIAgent, native transport conversion/normalization,
native SDK request path, and native registry dispatch. Only one harmless in-memory
`dani_provider_receipt` tool is admitted. The selected model must issue exactly one
structured call with a fresh nonce, then consume its unpredictable result and
return that exact receipt. Text-only responses, extra/native tools, duplicate
calls, wrong nonces and unconsumed results fail qualification. No filesystem,
browser, network, configured-profile MCP, memory, SOUL, project-context or
background-review tool/context is admitted to this challenge.

The probe makes at most two native SDK exchanges, with no added retry loop or
provider/model fallback, and has a 180-second outer process deadline. Native SDK
transport retry behavior remains native. The requested output limit is 1024
tokens, but Hermes 0.21.3 deliberately omits that parameter for the native ChatGPT
Codex backend: **it is not a guaranteed token/cost cap there**. An operator must
authorize that actual budget before invoking the command.

Only redacted outcome flags/counts and runtime identity are printed/stored.
Prompts, responses, nonces, receipts, provider exception bodies and credentials
are not persisted by the probe. It uses direct native API exchanges rather than
the persistent conversation loop. `provider-qualification.json` is owner-private
and bound to the exact Hermes version, configured/resolved provider, model,
sanitized endpoint and API mode. A fresh failed/timed-out probe invalidates prior
success; changed fingerprints require explicit requalification.

Changing models in the running app does not inherit the launcher's qualification.
Before a managed native model receives a foreground execution turn, Dani checks
that exact provider/model/endpoint/protocol identity. A saved matching proof is
reused; otherwise the first task performs the same bounded, harmless native
tool/result challenge as part of its model usage. The task's instructions and
browser capabilities are withheld if that challenge fails. Successful checks are
cached for that instance and credential/configuration contract. Browsing or
refreshing the catalog never starts inference, and background helpers cannot
authorize a new qualification probe.

Ordinary startup fails closed for unqualified runtimes, `auto`, cross-provider
fallback, the known agent proxy, and whole-agent `codex_app_server` mode. Native
`codex_responses` is supported; it is not confused with app-server mode. Existing
workspace config is preserved, including an intentionally disabled Hermes
instance. The operator must explicitly re-enable that local instance only after
qualification succeeds. No command here changes the existing live app.

Provider tool qualification is still **not real browser-task/autonomy evidence**.

Verify the served app independently:

```sh
pnpm control:omb doctor --url http://127.0.0.1:8812
pnpm control:omb models --url http://127.0.0.1:8812
```

The parent verification must additionally inspect the rendered UI, the actual
Hermes engine identity and the configured model, then execute the authorized
real-model disposable-browser receipt scenario in spec 140. Synthetic fixtures do
not establish autonomous success.

## Browser-only native policy

Hermes `hermes-acp` includes native `browser_*` tools. These are not Dani's browser
MCP and do not share its control broker. A YAML `disabled_toolsets` setting is not
sufficient for the direct ACP constructor.

Managed Hermes requests launch the version-qualified app-owned Python bootstrap
inside the selected virtualenv. Native `SessionManager` still constructs real
agents with its session/database, cwd, model, credentials and MCP setup.
The bootstrap enforces endpoint-mandated API protocols: Hermes 0.21.3 can restore
a stale Chat Completions mode and preserve it through ACP model switching, even
for the ChatGPT Codex endpoint that requires Responses. Correcting the protocol
does not replace the selected model, endpoint, credentials or conversation.

The native model switch also rebuilds its agent from profile toolsets, omitting
MCP mounts supplied by ACP. The version-qualified bootstrap retains only the
same session's explicit MCP toolsets and uses Hermes' native catalog refresh
before returning the replacement agent. Other sessions do not inherit those
mounts. The installed-runtime regression exercises the actual agents MCP proxy,
same-model rebinding, a different model, unchanged history, and an unrelated
unmounted session; it does not substitute a fake agent constructor.

Requests narrowed to `mcp:browser:*` additionally receive constructor toolset
restrictions and a dispatch fence. Non-browser tools cannot run even if native
MCP refresh adds a schema. Call-level selectors and approvals remain enforced by
Dani's browser broker. Unscoped requests retain their native tool inventory;
unsupported narrowed scopes fail explicitly. This is not an arbitrary-code
sandbox or a global native-package patch.

The isolated native profile uses supported `tools.tool_search.enabled: off`.
This exposes actual MCP tool names directly rather than wrapping them in native
search/describe/call helpers that would lose Dani's exact broker correlation.
It does not remove capabilities from ordinary native sessions. Browser-only
bootstrap rejects another setting rather than silently broadening its scope.
Configured profile MCP discovery is filtered out in that child only, so a saved
server cannot occupy Dani's `browser` name before its session-scoped mount.

The bundled server copies the same Python asset beside the driver. Installed
versions other than the qualified 0.21.3, missing sibling Python, or unsupported
constructor APIs fail closed for browser-only sessions. There is no global Python
patch, provider substitution, schema-only hiding, or zero-argument test factory.

Focused checks for the integration owner:

```sh
DANI_HERMES_POLICY_PYTHON="$HOME/.hermes/hermes-agent/venv/bin/python3" \
pnpm exec vitest run scripts/start-local-hermes.test.ts server/drivers/acp/hermes.test.ts server/drivers/acp/hermes-policy.test.ts
```

The browser constructor/dispatch inspection lives only in
`server/testing/hermes-native-policy-probe.py`, not the shipped production
bootstrap. It uses an isolated native home and a clearly synthetic MCP tool,
without inference. A second installed-constructor check admits only the provider
receipt tool and verifies that private memory/context and fallback are absent.
Offline protocol tests exercise ignored tools, nonce/count/result handling and
safe output without model calls. These checks skip if the managed interpreter is
absent; set `DANI_HERMES_POLICY_PYTHON` explicitly as shown. A skip or synthetic
fixture success is not runtime/provider qualification.

## Unified provider catalog

The root catalog retains exact native provider/model identities and configured
Pi, OpenCode, Kilo and compatible API routes. The selected native default shares
its provider's display group with the other models; display labels do not change
execution routing. Missing credentials, unreachable endpoints, unsupported
protocols and unconfirmed tool support remain unavailable, not substituted.

Configured Claude API discovery follows every
[Anthropic Models API page](https://platform.claude.com/docs/en/api/models/list)
using `limit=1000` and the returned `last_id` as `after_id`. All pages use the same
endpoint, credentials and eight-second deadline. Missing/repeated cursors or a
failed later page reject the incomplete catalog instead of presenting it as a
complete model inventory. OpenAI-compatible discovery remains unchanged.

Catalog availability is metadata admission, not successful inference or tool
qualification. The known tool-discarding loopback port 4187, silent-fallback port
4190, Claude subscription tokens and restricted original-client-only free routes
remain blocked. An offline Pi endpoint needs its actual transparent native API
service restored; no agent wrapper or alternate provider is started to mask it.

The integration owner should run the isolated catalog regressions:

```sh
pnpm exec vitest run server/cli-api-setup.test.ts server/drivers/acp/hermes-configured-providers.test.ts server/drivers/acp/hermes-model-catalog.test.ts
```

Then inspect the served inventory with the read-only `control:omb models` command
above, including unavailable reasons and exact provider/model IDs. Hosted account
access and an explicitly authorized native tool qualification are still required
before claiming any previously unavailable route usable.
