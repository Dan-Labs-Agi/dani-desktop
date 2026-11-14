# Enterprise computer-use policy

The strongest first step is **an admin-controlled computer policy with enforceable isolation defaults**, followed by a reliable audit trail. The repo has useful pieces, but the enterprise controls described in the issue are not simply switches that can be turned on.

| Area | What exists | What to build |
|---|---|---|
| **Policy** | [Command allowlists](../shared/command-allowlist.ts), provider approval modes, and a reviewed read-only tool list. The command allowlist explicitly does not cover arbitrary computer operations. | Admin-owned policy for allowed computers, applications, domains and action categories; precedence rules; approval routing; and enforcement at the execution boundary across every provider and access path. |
| **Audit** | [Admin activity](../server/admin-activity.ts) records redacted administrative changes, but writes are best-effort and local. | A separate, structured computer-action audit stream, export and delivery controls, retention, and integrity verification. First verify which actions and screenshots are actually captured across all drivers; the existing admin log does not establish that coverage. |
| **Isolation** | Host-computer consent and approval mechanisms exist; shared workspaces can default to Ask. | Admin policy that defaults enterprise users to an isolated VM or approved cloud environment, and explicitly controls whether host access is permitted. Apply it to selection, provisioning, execution and reconfiguration. |
| **Identity** | The [enterprise license](../enterprise/README.md) lists SSO as trusted identity headers behind an OIDC proxy. | Document and harden the proxy trust boundary, then add SCIM provisioning and deprovisioning if customers need automated lifecycle management. The entitlement alone is not a complete identity deployment. |
| **Budgets and residency** | Budget entitlement and spend-cap work exist. | Verify enforcement and attribution for each model and compute path; define what residency covers, including VM, model provider, logs, backups and support access. |
| **Security paper** | A [threat-model procedure](dani-sdd-kit/skills/threat-model/SKILL.md) is present in the repo. | Produce a threat model from the actual architecture, then publish a reviewed paper that distinguishes implemented controls, deployment responsibilities and planned work. |

I’d deliver this in three stages:

1. **Policy foundation:** admin-only configuration, deny-by-default enterprise host access, policy decisions recorded with actor and reason, and tests proving users and provider adapters cannot bypass it. Start with controls the platform can actually enforce: computer selection, tool capabilities and network destinations at the relevant boundary. A desktop screenshot alone cannot reliably prove which app or domain a click affects.
2. **Audit and operations:** capture action attempts, decisions, approvals and outcomes; provide scoped exports and SIEM delivery. Hash chaining needs externally retained or signed checkpoints to detect an attacker rewriting the whole log, plus explicit handling for delivery failures and sensitive screenshots.
3. **Enterprise integrations:** SCIM, verified budget enforcement, region-specific deployments and a security whitepaper backed by evidence and tests.

One correction to the issue: [approval modes](../shared/approval-mode.ts) are largely mapped to provider behavior, and `agent-tool-policy.ts` identifies read-only agent tools. Neither is an organization-wide computer policy engine today. Building a central enforcement layer is the substantive work.
