import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('download matrix verifies each README advertised format on its native OS',()=>{
 const workflow=read('.github/workflows/release.yml');
 for(const format of ['nsis','zip','dmg','deb','appimage'])assert.ok(workflow.includes('format: '+format));
 assert.equal((workflow.match(/format: dmg/g)||[]).length,2);
 assert.ok(workflow.includes('DANI_INSTALLER_FORMAT: ${{ matrix.format }}'));
 assert.ok(workflow.includes('${{ matrix.platform }} ${{ matrix.format }}'));
 assert.ok(workflow.includes('needs: [prepare, linux, windows, macos, download_check, checks]'));
 assert.ok(!workflow.includes('continue-on-error: true'));
});
test('Windows portable ZIP and Linux original AppImage are actually launched, not only inspected',()=>{
 const windows=read('scripts/verify-main-installed.cjs'),linux=read('scripts/verify-main-linux-installed.cjs');
 assert.ok(windows.includes("['nsis','zip'].includes(format)"));assert.ok(windows.includes('Expand-Archive -LiteralPath'));
 assert.ok(windows.includes("path.join(install,'Dani Bot.exe')"));assert.ok(windows.includes("launched=spawn(executable"));
 assert.ok(linux.includes("['deb','appimage'].includes(format)"));assert.ok(linux.includes('executable=installer;'));assert.ok(linux.includes('launched=spawn(executable'));
 for(const text of [windows,linux]){assert.ok(text.includes("'--user-data-dir='+path.join(temp,'electron-user-data')"));assert.ok(text.includes('DANI_FREE_PACKAGED_BUTTON_INSTALL_PASS'));assert.ok(text.includes('MAIN_INSTALLED_RELAUNCH_PASS'));assert.doesNotMatch(text,/--no-sandbox|--disable-gpu-sandbox/);}
});
test('all advertised downloads are hashed with aliases before native execution',()=>{
 const download=read('scripts/release-download-verify.mjs');assert.ok(download.includes('[target.versioned,target.alias,target.manifest]'));assert.ok(download.includes('verifyInstallerDownloads'));
 const policy=JSON.parse(read('scripts/release-policy.json'));assert.equal(policy.publicationApproved,false);
});
