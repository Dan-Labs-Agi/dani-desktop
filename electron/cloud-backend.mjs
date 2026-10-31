// The one place the desktop decides whether a hosted cloud service exists to talk to.
// This build ships with no cloud service configured: only an explicit DANI_CLOUD_ORIGIN
// makes cloud sign-in live. The compiled-in upstream vendor default and the upstream
// staging toggle never carry a user's account: with nothing configured, every
// cloud-account path stays inert.
//
// Trust semantics: a configured DANI_CLOUD_ORIGIN is exactly that - a configured
// endpoint. Passing the shape check below is NOT proof that Dan Lab operates the
// service or that it is authorized to receive user data; treating configuration as
// ownership would be an overclaim. An intentionally configured service is preserved
// and left functional, but nothing here auto-enables one.

export const SHIPPED_CLOUD_ORIGIN = null;

const text = value => typeof value === "string" && value.trim() ? value.trim() : null;

/** Shape check only: a configured endpoint must be a credential-free HTTPS origin
 *  (loopback http for fixtures). This validates syntax, never ownership. */
export function configuredCloudOrigin(value, { fixture = false } = {}) {
  const raw = text(value);
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password || url.hash || raw.includes("#")) return null;
  if (url.protocol === "https:") return url.origin;
  if (fixture && url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)) return url.origin;
  return null;
}

export function cloudServicePosture(env = process.env) {
  const origin = configuredCloudOrigin(env.DANI_CLOUD_ORIGIN);
  if (origin) return { inert: false, origin, reason: null };
  return { inert: true, origin: null, reason: "no-configured-cloud-service" };
}

export const CLOUD_UNAVAILABLE_MESSAGE =
  "Dani Bot Cloud is not available in this build: no cloud service is configured, and the upstream vendor's hosted service is not used.";
