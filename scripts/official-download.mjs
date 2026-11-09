// Bounded recovery for official build inputs. Callers keep their integrity checks.
export async function downloadBytes(url, { githubRelease } = {}) {
  const transient = new Set([408, 429, 500, 502, 503, 504]);
  let failure;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      await response.body?.cancel().catch(() => {});
      failure = new Error(`official download failed: HTTP ${response.status} (${new URL(url).host})`);
      if (!transient.has(response.status)) throw failure;
    } catch (error) {
      if (!(error instanceof TypeError) && !["AbortError", "TimeoutError"].includes(error?.name)) throw error;
      failure = error;
    }
    if (attempt < 3) {
      console.warn(`official download attempt ${attempt}/3 failed: ${failure.message}`);
      await new Promise(resolve => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
    }
  }
  if (!githubRelease) throw failure;
  const { owner, repo, tag, asset } = githubRelease;
  if (![owner, repo].every(value => /^[a-zA-Z0-9_.-]+$/.test(value))) throw new Error("invalid official repository");
  const api = `https://api.github.com/repos/${owner}/${repo}/releases`;
  const metadata = await fetch(`${api}/tags/${encodeURIComponent(tag)}`, { signal: AbortSignal.timeout(120_000), headers: { Accept: "application/vnd.github+json" } });
  if (!metadata.ok) throw new Error(`official release metadata failed: HTTP ${metadata.status}`);
  const release = await metadata.json();
  if (release.tag_name !== tag || !Array.isArray(release.assets)) throw new Error("official release tag mismatch");
  const matches = release.assets.filter(entry => entry.name === asset);
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id <= 0) throw new Error("official release asset missing or ambiguous");
  console.warn(`official direct download exhausted; using canonical asset API for ${asset}`);
  const response = await fetch(`${api}/assets/${matches[0].id}`, { redirect: "follow", signal: AbortSignal.timeout(120_000), headers: { Accept: "application/octet-stream" } });
  if (!response.ok) throw new Error(`official asset API failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
