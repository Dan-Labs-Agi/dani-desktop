// Refresh latest-mac.yml after notarization stapling rewrote the artifacts.
// Preserve electron-builder's file order: the first entry remains the legacy
// path/sha512 fallback. Blockmaps need regeneration separately.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function regenerateMacFeed(feedPath = join(root, "release", "latest-mac.yml")) {
  const releaseDir = dirname(feedPath);
  const feed = parse(await readFile(feedPath, "utf8"));
  if (!feed || typeof feed !== "object" || Array.isArray(feed) || !Array.isArray(feed.files) || feed.files.length === 0) {
    throw new Error("latest-mac.yml must contain a non-empty files array");
  }

  for (const entry of feed.files) {
    const url = entry?.url;
    // Release artifacts live beside the feed, never at URLs or external paths.
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof url !== "string" ||
        !url || url === "." || url === ".." || basename(url) !== url || /[\\:\0]/.test(url)) {
      throw new Error(`Invalid artifact URL/reference in latest-mac.yml: ${url}`);
    }
    const file = join(releaseDir, url);
    if (!(await lstat(file)).isFile()) {
      throw new Error(`Artifact must be a regular file, not a symlink: ${url}`);
    }
    const hash = createHash("sha512");
    let size = 0;
    for await (const chunk of createReadStream(file)) {
      hash.update(chunk);
      size += chunk.length;
    }
    entry.size = size;
    entry.sha512 = hash.digest("base64");
  }
  feed.path = feed.files[0].url;
  feed.sha512 = feed.files[0].sha512;
  feed.releaseDate = new Date().toISOString();

  // Validate and hash every artifact before replacing the previous feed.
  const updated = stringify(feed);
  const temporary = `${feedPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, updated, { flag: "wx" });
    await rename(temporary, feedPath);
  } finally {
    await rm(temporary, { force: true });
  }
  for (const { url, size } of feed.files) console.log(`  ok ${url} (${size} bytes)`);
  console.log(`latest-mac.yml verified against ${feed.files.length} artifacts`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await regenerateMacFeed(process.argv[2]);
}
