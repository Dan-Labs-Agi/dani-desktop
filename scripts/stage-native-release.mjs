import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { copyFile, cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const targets = ['darwin-x64', 'darwin-arm64', 'win32-x64', 'linux-x64'];
const repository = process.env.GITHUB_REPOSITORY;
const source = process.env.GITHUB_SHA;
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (repository !== 'Dan-Labs-Agi/dani-desktop' || !/^[a-f0-9]{40}$/.test(source ?? '')) throw new Error('Unexpected release repository or source');
const digest = async (file, algorithm = 'sha256', encoding = 'hex') => {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
};
const ready = status => status.state === 'ready' && status.readiness?.taskReady === true && status.readiness?.runtime?.hermes === true && status.readiness?.runtime?.opencode === true && status.readiness?.modelRoute?.state === 'ready' && status.error === null;
const api = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

if (process.argv[2] === 'stage') {
  const target = process.argv[3];
  if (!targets.includes(target)) throw new Error('Unsupported native target');
  const evidence = process.env.DANI_NATIVE_EVIDENCE_DIR;
  if (!evidence) throw new Error('Native evidence directory is required');
  for (const phase of ['INSTALL', 'RELAUNCH', 'REPAIR']) {
    const status = JSON.parse(await readFile(path.join(evidence, `${phase}.json`), 'utf8'));
    if (!ready(status)) throw new Error(`${target} ${phase} did not reach verified task readiness`);
    if ((await lstat(path.join(evidence, `${phase}.png`))).size === 0) throw new Error(`${target} ${phase} screenshot is missing`);
  }
  const directory = path.join('native-artifacts', `verified-native-${target}`);
  await mkdir(directory, { recursive: true });
  const names = (await readdir('release')).filter(name => name.startsWith(`DaniBot-${version}-`) && /\.(?:dmg|zip|exe|deb|AppImage|blockmap)$/.test(name));
  const required = target.startsWith('darwin-') ? ['.dmg', '.zip'] : target === 'win32-x64' ? ['.exe', '.zip'] : ['.deb', '.AppImage'];
  for (const extension of required) if (!names.some(name => name.endsWith(extension))) throw new Error(`${target} is missing its ${extension} package`);
  const feed = target.startsWith('darwin-') ? 'latest-mac.yml' : target === 'win32-x64' ? 'latest.yml' : 'latest-linux.yml';
  names.push(feed);
  const files = [];
  for (const name of names.sort()) {
    const file = path.join('release', name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular release file: ${file}`);
    files.push({ name, size: info.size, sha256: await digest(file) });
    await copyFile(file, path.join(directory, name));
  }
  await cp(evidence, path.join(directory, 'evidence'), { recursive: true });
  await writeFile(path.join(directory, 'verification.json'), JSON.stringify({ version, source, target, phases: ['INSTALL', 'RELAUNCH', 'REPAIR'], files }, null, 2) + '\n');
  console.log(JSON.stringify({ event: 'native-artifact-staged', target, directory, files }));
} else if (process.argv[2] === 'release') {
  const run = process.env.GITHUB_RUN_ID;
  const attempt = process.env.GITHUB_RUN_ATTEMPT;
  if (!/^\d+$/.test(run ?? '') || !/^\d+$/.test(attempt ?? '')) throw new Error('Missing workflow run identity');
  const directory = path.resolve('release-candidate');
  await mkdir(directory);
  const reports = [];
  const feeds = {};
  for (const target of targets) {
    const origin = path.join('native-artifacts', `verified-native-${target}`);
    const report = JSON.parse(await readFile(path.join(origin, 'verification.json'), 'utf8'));
    if (report.target !== target || report.source !== source || report.version !== version || JSON.stringify(report.phases) !== JSON.stringify(['INSTALL', 'RELAUNCH', 'REPAIR'])) throw new Error(`Native proof identity mismatch for ${target}`);
    for (const phase of report.phases) {
      if (!ready(JSON.parse(await readFile(path.join(origin, 'evidence', `${phase}.json`), 'utf8')))) throw new Error(`${target} ${phase} proof is not ready`);
    }
    for (const file of report.files) {
      if (path.basename(file.name) !== file.name) throw new Error('Unsafe native artifact filename');
      const original = path.join(origin, file.name);
      if ((await lstat(original)).size !== file.size || await digest(original) !== file.sha256) throw new Error(`Downloaded artifact changed: ${target}/${file.name}`);
      if (file.name.endsWith('.yml')) {
        const feed = YAML.parse(await readFile(original, 'utf8'));
        if (feed.version !== version) throw new Error(`Update feed version mismatch: ${target}`);
        feeds[target] = feed;
      } else {
        const destination = path.join(directory, file.name);
        try { await lstat(destination); throw new Error(`Duplicate native package: ${file.name}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await copyFile(original, destination);
      }
    }
    await cp(path.join(origin, 'evidence'), path.join(directory, 'evidence', target), { recursive: true });
    reports.push(report);
  }
  const mac = { ...feeds['darwin-x64'], files: [...feeds['darwin-x64'].files, ...feeds['darwin-arm64'].files] };
  const combined = { 'latest-mac.yml': mac, 'latest.yml': feeds['win32-x64'], 'latest-linux.yml': feeds['linux-x64'] };
  for (const [name, feed] of Object.entries(combined)) {
    if (!Array.isArray(feed?.files) || feed.files.length === 0) throw new Error(`Empty update feed: ${name}`);
    for (const entry of feed.files) {
      if (path.basename(entry.url) !== entry.url) throw new Error('Unsafe update feed filename');
      const file = path.join(directory, entry.url);
      if ((await lstat(file)).size !== entry.size || await digest(file, 'sha512', 'base64') !== entry.sha512) throw new Error(`Update feed does not match verified bytes: ${entry.url}`);
    }
    if (feed.path !== feed.files[0].url || feed.sha512 !== feed.files[0].sha512) throw new Error(`Legacy update feed identity mismatch: ${name}`);
    await writeFile(path.join(directory, name), YAML.stringify(feed));
  }
  await writeFile(path.join(directory, 'NATIVE_VERIFICATION.json'), JSON.stringify({ version, source, run: `https://github.com/${repository}/actions/runs/${run}`, reports }, null, 2) + '\n');
  execFileSync('tar', ['-czf', path.join(directory, 'native-install-evidence.tar.gz'), '-C', directory, 'evidence']);
  const files = (await readdir(directory)).filter(name => name !== 'evidence').sort();
  const hashes = [];
  for (const name of files) hashes.push(`${await digest(path.join(directory, name))}  ${name}`);
  await writeFile(path.join(directory, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
  files.push('SHA256SUMS.txt');
  const tag = `v${version}-native.${run}.${attempt}`;
  const notes = path.join(directory, 'release-notes.md');
  await writeFile(notes, `# Dani Bot ${version} native installer candidate\n\nSource: ${source}\n\nNative run: https://github.com/${repository}/actions/runs/${run}\n\n| Target | Installed checks |\n| --- | --- |\n${targets.map(target => `| ${target} | Real app first launch, verified runtimes/model route, relaunch, damaged-runtime repair; synthetic user data preserved |`).join('\n')}\n\nThe downloaded Actions packages and generated update-feed hashes were verified before this draft was created. SHA256SUMS.txt identifies the exact attached bytes. NATIVE_VERIFICATION.json and native-install-evidence.tar.gz contain source-linked native status and screenshots.\n\nPRIVATE CANDIDATE ONLY. macOS is ad-hoc signed, not Developer ID signed or notarized. Windows is unsigned. Gatekeeper/SmartScreen acceptance and the full feature/voice matrix are not certified. This draft does not change public latest or silently select a different model/harness. Linux installed lifecycle covers the DEB; the AppImage is built but its independent lifecycle is not claimed.\n`);
  api(['release', 'create', tag, '--repo', repository, '--draft', '--prerelease', '--target', source, '--title', `Dani Bot ${version} - verified native installer candidate`, '--notes-file', notes]);
  api(['release', 'upload', tag, ...files.map(name => path.join(directory, name)), '--repo', repository]);
  const uploaded = JSON.parse(api(['release', 'view', tag, '--repo', repository, '--json', 'url,isDraft,targetCommitish,assets']));
  if (!uploaded.isDraft || uploaded.targetCommitish !== source) throw new Error('Release draft/source identity changed');
  for (const name of files) {
    const asset = uploaded.assets.find(asset => asset.name === name);
    const file = path.join(directory, name);
    if (!asset || asset.size !== (await lstat(file)).size || asset.digest !== `sha256:${await digest(file)}`) throw new Error(`GitHub upload does not match verified bytes: ${name}`);
  }
  console.log(JSON.stringify({ event: 'native-release-verified', tag, url: uploaded.url, source, targets }));
} else {
  throw new Error('Usage: stage-native-release.mjs stage TARGET | release');
}
