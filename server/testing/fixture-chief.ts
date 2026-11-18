/** Adapter and feature fixtures do not script the separate Chief review loop.
 * Supervision tests retain their seeded Chief and never call this helper. */
export async function disableFixtureChiefs(url: string): Promise<void> {
  const list = await fetch(`${url}/api/bots`);
  if (!list.ok) throw new Error(`fixture bot list failed: ${list.status}`);
  const { bots } = await list.json() as { bots: Array<{ id: string; chiefOfStaff?: boolean }> };
  for (const bot of bots) {
    if (!bot.chiefOfStaff) continue;
    const result = await fetch(`${url}/api/bots/${bot.id}`, {
      method: "PATCH", headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify({ chiefOfStaff: false }),
    });
    if (!result.ok) throw new Error(`fixture Chief isolation failed: ${result.status}`);
  }
}
