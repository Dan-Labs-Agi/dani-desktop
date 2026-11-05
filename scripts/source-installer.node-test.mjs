import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const root = path.resolve(import.meta.dirname, '..');
const sh = readFileSync(path.join(root, 'install.sh'), 'utf8');
const ps = readFileSync(path.join(root, 'install.ps1'), 'utf8');
const pinned = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).packageManager.split('@')[1];
function fixture(t, { pnpm = true, version = pinned, gitFailure = false, mergeFailure = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dani-installer-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin'); mkdirSync(bin);
  const log = path.join(dir, 'calls');
  const stub = (name, text) => writeFileSync(path.join(bin, name), '#!/bin/sh\n' + text, { mode: 0o755 });
  stub('git', `echo "git $*" >> '${log}'\n[ "$1" = --version ] && { echo 'git version 2.0'; exit 0; }\n[ "$1" = merge ] && exit ${mergeFailure ? 1 : 0}\nexit ${gitFailure ? 1 : 0}\n`);
  stub('node', `case "$1" in -p) echo 24;; -v) echo v24.0.0;; esac\n`);
  stub('corepack', `echo MUTATION >> '${log}'; exit 0\n`);
  stub('awk', 'while read first second third; do echo "$third"; done\n');
  if (pnpm) stub('pnpm', `echo "pnpm $*" >> '${log}'\n[ "$1" = --version ] && { echo '${version}'; exit 0; }\nexit 0\n`);
  const run = (...args) => spawnSync('/bin/sh', [path.join(root, 'install.sh'), ...args], { cwd: dir, env: { ...process.env, PATH: bin, DANI_INSTALL_DIR: path.join(dir, 'checkout') }, encoding: 'utf8' });
  const calls = () => { try { return readFileSync(log, 'utf8'); } catch { return ''; } };
  return { dir, run, calls };
}
test('check-only with missing pnpm fails without Corepack mutation or checkout', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t, { pnpm: false }); const result = f.run('--check');
  assert.equal(result.status, 1); assert.match(result.stderr, /pnpm is not installed/);
  assert.doesNotMatch(f.calls(), /MUTATION|clone|fetch|merge|install/);
});
test('check-only with pinned pnpm succeeds and only reads versions', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); const result = f.run('--check');
  assert.equal(result.status, 0, result.stderr); assert.doesNotMatch(f.calls(), /MUTATION|clone|fetch|merge|install/);
});
test('incorrect pnpm is rejected before source changes', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t, { version: '99.0.0' }); const result = f.run('--check');
  assert.equal(result.status, 1); assert.match(result.stderr, /does not match packageManager/);
  assert.doesNotMatch(f.calls(), /clone|fetch|merge|install/);
});
test('failed fetch stops instead of silently building stale checkout', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t, { gitFailure: true }); mkdirSync(path.join(f.dir, 'checkout', '.git'), { recursive: true });
  const result = f.run(); assert.equal(result.status, 1); assert.match(result.stderr, /refusing to package stale source/);
  assert.doesNotMatch(f.calls(), /merge|pnpm install|pnpm package/);
});

test('failed fast-forward merge stops instead of building stale checkout', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t, { mergeFailure: true }); mkdirSync(path.join(f.dir, 'checkout', '.git'), { recursive: true });
  const result = f.run(); assert.equal(result.status, 1); assert.match(result.stderr, /refusing to package stale source/);
  assert.match(f.calls(), /git fetch/); assert.match(f.calls(), /git merge/);
  assert.doesNotMatch(f.calls(), /pnpm install|pnpm package/);
});
test('both platform helpers use pinned manager and frozen lockfile without automatic tool installation', () => {
  for (const source of [sh, ps]) {
    assert.match(source, /pnpm install --frozen-lockfile/);
    assert.ok(source.includes(pinned));
    assert.doesNotMatch(source, /corepack enable|corepack prepare|pnpm@latest|continuing with what is here/);
    assert.match(source, /does not install or launch/);
  }
  assert.match(ps, /git fetch[^\n]+\n\s+if \(\$LASTEXITCODE -ne 0\)/);
});

// Windows exercises the real PowerShell helper with inert in-process commands.
for (const scenario of ['missing', 'pinned', 'wrong', 'fetch', 'merge']) {
  test('PowerShell helper safely handles '+scenario, {skip: process.platform !== 'win32'}, t => {
    const dir=mkdtempSync(path.join(os.tmpdir(),'dani-powershell-test-'));
    t.after(()=>rmSync(dir,{recursive:true,force:true}));
    const checkout=path.join(dir,'checkout');mkdirSync(path.join(checkout,'.git'),{recursive:true});
    const log=path.join(dir,'calls');
    const quote=value=>"'"+value.replaceAll("'","''")+"'";
    const script=`$env:DANI_INSTALL_DIR=${quote(checkout)}
Set-Location ${quote(dir)}
function Get-Command { param($Name,$ErrorAction) if($Name -eq 'pnpm' -and ${scenario==='missing'?'$true':'$false'}) {return $null}; return @{Name=$Name} }
function git { Add-Content ${quote(log)} ('git '+($args -join ' ')); $global:LASTEXITCODE=0; if(($args[0] -eq 'fetch' -and ${scenario==='fetch'?'$true':'$false'}) -or ($args[0] -eq 'merge' -and ${scenario==='merge'?'$true':'$false'})) {$global:LASTEXITCODE=1}; if($args[0] -eq '--version') {Write-Output 'git version 2'} }
function node {if($args[0] -eq '-p') {Write-Output '24'} else {Write-Output 'v24.0.0'} }
function pnpm { Add-Content ${quote(log)} ('pnpm '+($args -join ' ')); $global:LASTEXITCODE=0; if($args[0] -eq '--version') {Write-Output '${scenario==='wrong'?'99.0.0':pinned}'} }
& ${quote(path.join(root,'install.ps1'))} ${['fetch','merge'].includes(scenario)?'':'-CheckOnly'}
exit $LASTEXITCODE
`;
    const file=path.join(dir,'fixture.ps1');writeFileSync(file,script);
    const result=spawnSync('pwsh',['-NoProfile','-File',file],{encoding:'utf8',timeout:20000});
    assert.equal(result.error,undefined,String(result.error));
    assert.equal(result.status,scenario==='pinned'?0:1,result.stdout+result.stderr);
    const calls=(()=>{try{return readFileSync(log,'utf8')}catch{return ''}})();
    assert.doesNotMatch(calls,/pnpm install|pnpm package|clone|MUTATION/);
    if(scenario==='fetch') {assert.match(calls,/git fetch/);assert.doesNotMatch(calls,/git merge/)}
    if(scenario==='merge') assert.match(calls,/git merge/);
    if(scenario==='missing') assert.match(result.stdout,/pnpm is not installed/);
    if(scenario==='wrong') assert.match(result.stdout,/does not match packageManager/);
  });
}
