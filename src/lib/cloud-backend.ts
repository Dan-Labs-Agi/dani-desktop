// Cloud backend boundary for Dani Bot.
//
// This build ships with NO cloud service configured: no accounts service, no
// admin portal, no billing, no hosted models. Every cloud-looking surface in
// the UI would land on the upstream OpenMausBot project's services
// (admin.openmausbot.com, accounts.openmausbot.com, www.openmausbot.com),
// which Dan Lab does not run. Presenting those as "Dani Bot Cloud" would be
// misleading, so one-click cloud entry points are gated here and shown an
// honest local-only notice instead.
//
// What stays working: everything local. An explicitly user-entered upstream
// address (Settings -> Organization -> Advanced) is that person's informed
// choice to use their own upstream account and is left functional.
//
// Trust semantics: SHIPPED_CLOUD_BACKEND records what this build ships with,
// nothing more. If a backend is ever configured here, that makes it the
// configured endpoint - it is NOT proof that Dan Lab operates it or that it
// is authorized to receive user data. Ownership and disclosure authority are
// separate decisions and must be established before any data flows.

export const SHIPPED_CLOUD_BACKEND: null = null;

export type CloudSurfaceStatus =
  | { available: true }
  | { available: false; reason: "no-configured-backend"; upstreamLabel: string };

// One-click cloud entry points (org sign-in, billing, hosted upgrades).
// Available only when a backend is configured for this build; configuration
// alone never implies the endpoint is operated by Dan Lab or data-safe.
export function cloudSignInSurface(): CloudSurfaceStatus {
  if (SHIPPED_CLOUD_BACKEND === null) {
    return { available: false, reason: "no-configured-backend", upstreamLabel: "the upstream OpenMausBot project" };
  }
  return { available: true };
}
