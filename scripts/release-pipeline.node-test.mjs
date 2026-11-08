import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const release=readFileSync(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
const checks=readFileSync(new URL('../.github/workflows/main-installed-test.yml',import.meta.url),'utf8');
test('existing CI never adds paid-risk artifact or cache storage',()=>{const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');assert.doesNotMatch(ci,/upload-artifact@|download-artifact@|cache: gradle/);});
test('PR checks run with read-only contents and no release publishing path',()=>{
 assert.match(checks,/pull_request:\n    branches: \[main, prod\]/);assert.match(checks,/contents: read/);assert.doesNotMatch(checks,/contents: write|upload-artifact@|cache@/);assert.match(checks,/DANI_VERIFY_FREE_INSTALL: '1'/);
});
test('merged builds stage directly without Actions artifact or cache storage',()=>{
 assert.match(release,/push:\n    branches:\n      - main/);assert.doesNotMatch(release,/upload-artifact@|download-artifact@|cache@|pull_request_target/);assert.match(release,/release-staging.mjs upload/);
});
test('publication waits for every native exact-download install and approval',()=>{
 assert.match(release,/needs: \[prepare, linux, windows, macos, download_check, checks\]/);assert.match(release,/release-download-verify.mjs/);assert.match(release,/macos-15-intel/);
 const publish=readFileSync(new URL('./release-publish.mjs',import.meta.url),'utf8');assert.match(publish,/publicationApproved!==true/);assert.match(publish,/--latest=\$\{!policy.prerelease\}/);
});
test('download links and updater use the same current repository',()=>{
 const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');const builder=readFileSync(new URL('../electron-builder.yml',import.meta.url),'utf8');assert.match(readme,/Dan-Labs-Agi\/dani-desktop\/releases\/latest\/download/);assert.match(builder,/owner: Dan-Labs-Agi/);assert.doesNotMatch(readme,/github.com\/somdipto\/dani-desktop\/releases/);
});
test('native install checks exercise the Dani Free button without starting a model service',()=>{
 for(const file of ['verify-main-installed.cjs','verify-main-mac-installed.cjs','verify-main-linux-installed.cjs']){
 const text=readFileSync(new URL('./'+file,import.meta.url),'utf8');assert.match(text,/DANI_FREE_PACKAGED_BUTTON_INSTALL_PASS/);assert.match(text,/install must not start a model service/);assert.match(text,/DANI_VERIFY_FREE_INSTALL/);
 }
});

test('Mac and Windows zip basenames cannot collide in release staging',()=>{const builder=readFileSync(new URL('../electron-builder.yml',import.meta.url),'utf8');assert.match(builder,/mac:\n  artifactName: DaniBot-\$\{version\}-mac-\$\{arch\}/);});
test('approval is off until the owner decides the release audience and wording',()=>{const policy=JSON.parse(readFileSync(new URL('./release-policy.json',import.meta.url),'utf8'));assert.equal(policy.publicationApproved,false);assert.equal(policy.prerelease,true);});

test('installer autolaunch inherits the disposable product data profile',()=>{
 for(const file of ['verify-main-installed.cjs','verify-main-mac-installed.cjs','verify-main-linux-installed.cjs']){
 const text=readFileSync(new URL('./'+file,import.meta.url),'utf8');
 assert.ok(text.indexOf('process.env.DANI_DATA_DIR=data;')<text.indexOf('const installer'));
 assert.ok(text.indexOf('process.env.OMB_DATA_DIR=data;')<text.indexOf('const installer'));
 assert.match(text,/setup reported installed without config in the explicitly isolated profile/);
 }
});

test('setup waits for the awaited status, not a truthy async predicate',async()=>{
 const {waitDaniFreeSetup}=await import('./wait-dani-free-setup.cjs');
 let polls=0,clock=0;
 const status=await waitDaniFreeSetup({evaluate:async()=>++polls<3?{phase:'installing'}:{phase:'installed',modelReady:false}},{sleep:async()=>{clock+=1000},now:()=>clock});
 assert.equal(status.phase,'installed');assert.equal(polls,3);
 await assert.rejects(()=>waitDaniFreeSetup({evaluate:async()=>({phase:'failed',message:'locked'})}),/locked/);
 await assert.rejects(()=>waitDaniFreeSetup({evaluate:async()=>({phase:'installing'})},{timeout:1,sleep:async()=>{clock+=1000},now:()=>clock}),/deadline/);
 for(const file of ['verify-main-installed.cjs','verify-main-mac-installed.cjs','verify-main-linux-installed.cjs']){
  const text=readFileSync(new URL('./'+file,import.meta.url),'utf8');assert.doesNotMatch(text,/waitForFunction\(async/);assert.match(text,/await waitDaniFreeSetup/);
 }
});
test('Linux default smoke executable matches package name',()=>{const text=readFileSync(new URL('./smoke-linux-package.mjs',import.meta.url),'utf8');assert.match(text,/"linux-unpacked", "danibot"/);});
test('broad CI retains every OS, deterministic eight-way coverage and the secondary suites',()=>{
 const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
 assert.match(ci,/os: \[macos-latest, ubuntu-latest, windows-latest\]/);
 assert.match(ci,/shard: \[1, 2, 3, 4, 5, 6, 7, 8\]/);
 assert.match(ci,/fail-fast: false/);
 assert.match(ci,/timeout-minutes: 30/);
 assert.match(ci,/pnpm exec vitest run --shard=\$\{\{ matrix.shard \}\}\/8/);
 assert.match(ci,/pnpm broker:test && pnpm test:electron && pnpm test:packaged-server/);
 assert.match(ci,/if: matrix.shard == 1/);
 assert.doesNotMatch(ci,/--passWithNoTests|--exclude|continue-on-error: true\s*\n\s*run: pnpm exec vitest run --shard/);
});

test('aggregate CI rejects missing, failed, cancelled or skipped mandatory jobs',()=>{
 const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
 assert.match(ci,/name: CI\n    if: always\(\)/);
 assert.match(ci,/needs: \[test, control-plane, package-linux, detect-optional-jobs, sdd, ios, android\]/);
 assert.match(ci,/jobs\[name\]\?\.result !== "success"/);
 assert.match(ci,/outputs\[name\] === "true" \? "success" : "skipped"/);
});
