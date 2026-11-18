import { BUILT_IN_INSTANCE_DRIVERS } from "../../src/lib/built-in-instances.ts";

/** Shadow every auto-added provider before supplying synthetic engines. A short
 * hand-written list goes stale when the product fleet gains another engine. */
export function fixtureProviderShadows(): Record<string, { driver: string; enabled: false }> {
  return Object.fromEntries(Object.keys(BUILT_IN_INSTANCE_DRIVERS).map(id => [id, {
    driver: "not-a-real-driver", enabled: false as const,
  }]));
}
