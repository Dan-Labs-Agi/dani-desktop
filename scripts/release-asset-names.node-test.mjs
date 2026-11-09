import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseAssetNames } from './release-asset-names.mjs';

test('parallel OS uploads cannot collide on builder diagnostics, and retain required update metadata', () => {
  const common = ['builder-debug.yml', 'builder-effective-config.yaml', 'builder-effective-config.yml', 'notes.txt'];
  const outputs = {
    linux: ['DaniBot-0.1.139-x86_64.AppImage', 'DaniBot.AppImage', 'DaniBot-0.1.139-amd64.deb', 'danibot-amd64.deb', 'latest-linux.yml'],
    windows: ['DaniBot-0.1.139-setup.exe', 'DaniBot-setup.exe', 'DaniBot-0.1.139-x64.zip', 'DaniBot-Windows-Portable.zip', 'DaniBot-0.1.139-setup.exe.blockmap', 'latest.yml'],
    macos: ['DaniBot-0.1.139-arm64.dmg', 'DaniBot-0.1.139-x64.dmg', 'DaniBot-Silicon.dmg', 'DaniBot-Intel.dmg', 'DaniBot-0.1.139-mac-arm64.zip', 'DaniBot-0.1.139-mac-x64.zip', 'DaniBot-0.1.139-mac-arm64.zip.blockmap', 'latest-mac.yml'],
  };
  const all = [];
  for (const [platform, expected] of Object.entries(outputs)) {
    const actual = releaseAssetNames([...common, ...expected], platform);
    assert.deepEqual(actual, expected.sort());
    all.push(...actual);
  }
  assert.equal(new Set(all).size, all.length);
});

test('asset selection refuses an unknown platform and paths instead of basenames', () => {
  assert.throws(() => releaseAssetNames(['latest.yml'], 'other'), /Unknown release platform/);
  assert.deepEqual(releaseAssetNames(['../DaniBot-setup.exe', 'DaniBot/a.exe', 'DaniBot\\a.exe', 'latest-linux.yml'], 'windows'), []);
});

test('the actual staging command uploads only selected assets and its matching checksum manifest', { skip: process.platform === 'win32' }, async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, delimiter } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = mkdtempSync(join(tmpdir(), 'dani-stage-assets-'));
  try {
    mkdirSync(join(root, 'release'));
    mkdirSync(join(root, 'bin'));
    const names = ['DaniBot-0.1.139-setup.exe', 'DaniBot-setup.exe', 'latest.yml'];
    for (const name of [...names, 'builder-debug.yml']) writeFileSync(join(root, 'release', name), name);
    const sha = 'a'.repeat(40);
    writeFileSync(join(root, 'bin', 'gh'), `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);
if(args[1]==='view')console.log(JSON.stringify({isDraft:true,targetCommitish:'${sha}'}));
else if(args[1]==='upload')fs.appendFileSync(process.env.FIXTURE_UPLOADS,JSON.stringify(args)+'\\n');
else process.exit(4);
`, { mode: 0o755 });
    execFileSync(process.execPath, [fileURLToPath(new URL('./release-staging.mjs', import.meta.url)), 'upload', 'v0.1.139-validation.aaaaaaaaaaaa', sha, 'windows'], {
      cwd: root, env: { ...process.env, GITHUB_REPOSITORY: 'fixture/repo', FIXTURE_UPLOADS: join(root, 'uploads'), PATH: join(root, 'bin') + delimiter + process.env.PATH },
    });
    const uploaded = readFileSync(join(root, 'uploads'), 'utf8').trim().split('\n').map(line => JSON.parse(line)[3].replaceAll('\\', '/'));
    assert.deepEqual(uploaded, [...names.sort(), 'windows-SHA256SUMS.txt'].map(name => 'release/' + name));
    const sums = readFileSync(join(root, 'release', 'windows-SHA256SUMS.txt'), 'utf8');
    assert.ok(!sums.includes('builder-debug'));
    assert.equal(sums.trim().split('\n').length, names.length);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
