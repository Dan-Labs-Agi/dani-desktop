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
 assert.match(release,/needs: \[prepare, linux, windows, macos, download_check\]/);assert.match(release,/release-download-verify.mjs/);assert.match(release,/macos-15-intel/);
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
