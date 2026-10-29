// Cloud backend boundary for Dani Bot.
//
// Dan Lab operates NO cloud backend for this build: no accounts service, no
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

export const OWNED_CLOUD_BACKEND: null = null;

export type CloudSurfaceStatus =
  | { available: true }
  | { available: false; reason: "no-owned-backend"; upstreamLabel: string };

// One-click cloud entry points (org sign-in, billing, hosted upgrades).
// Available only if and when Dan Lab actually operates a backend.
export function cloudSignInSurface(): CloudSurfaceStatus {
  if (OWNED_CLOUD_BACKEND === null) {
    return { available: false, reason: "no-owned-backend", upstreamLabel: "the upstream OpenMausBot project" };
  }
  return { available: true };
}
