import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../electron/main.mjs',import.meta.url),'utf8');
const verifier=readFileSync(new URL('./verify-main-mac-installed.cjs',import.meta.url),'utf8');
test('phase diagnostics are opt-in labels, never credential values',()=>{
 assert.match(main,/function nativeVerifyPhase\(phase\) \{\n  if \(process.env.DANI_NATIVE_VERIFY === "1"\) console.log\("DANI_NATIVE_PHASE", phase\);\n\}/);
 for(const phase of ['data-lease-start','data-lease-ready','credential-load-start','credential-load-ready','credential-migration-start','credential-migration-ready','phone-identity-start','phone-identity-ready','server-start'])assert.ok(main.includes('nativeVerifyPhase("'+phase+'")'));
 assert.doesNotMatch(main,/nativeVerifyPhase\([^)]*(secureCredentials|phoneSecretIdentity|credentials\.bin)/);
});
test('installed UI wait has one bounded deadline, checks exit, captures failures',()=>{
 assert.match(verifier,/const deadline=Date.now\(\)\+120000/);
 assert.match(verifier,/while\(Date.now\(\)<deadline\)/);
 assert.match(verifier,/launched.exitCode!==null \|\| launched.signalCode!==null/);
 assert.doesNotMatch(verifier,/for\(let i=0;i<120;i\+\+\)|for\(let j=0;j<90;j\+\+\)/);
 assert.match(verifier,/connectOverCDP\('http:\/\/127.0.0.1:9333',\{timeout:3000\}\)/);
 assert.match(verifier,/STARTUP_DESKTOP_SCREENSHOT_END/);
 assert.match(verifier,/capture\(page,'STARTUP_FAILURE_'\+index\)/);
});
test('failure log reads are only reported product logs, never credential files or global policy changes',()=>{
 assert.match(verifier,/profile.logs!==expected/);
 assert.ok(verifier.includes("require('node:os').userInfo().homedir"));
 assert.ok(!verifier.includes("require('node:os').homedir()"));
 assert.match(verifier,/\['server.log','desktop-crashes.log'\]/);
 assert.doesNotMatch(verifier,/readFileSync\([^\n]*(?:credentials\.bin|keychain)|xattr\s+-[dr]|spctl.*--master-disable|security\s+unlock-keychain/);
 assert.match(verifier,/DANI_FREE_PACKAGED_BUTTON_INSTALL_PASS/);
 assert.match(verifier,/MAIN_INSTALLED_AVATAR_PRESENTATION_PASS/);
 assert.match(verifier,/MAIN_INSTALLED_RELAUNCH_PASS/);
});

test('macOS keeps native HOME and product data remains explicitly isolated',()=>{
 assert.ok(verifier.includes("process.platform!=='win32' && process.platform!=='darwin'"));
 assert.ok(verifier.includes('process.env.DANI_DATA_DIR=data;'));
 assert.ok(verifier.includes('process.env.OMB_DATA_DIR=data;'));
 assert.ok(verifier.includes('DANI_DATA_DIR:data,OMB_DATA_DIR:data'));
 assert.doesNotMatch(verifier,/security.*(?:create-keychain|unlock-keychain|delete-keychain|set-keychain)/);
});

test('usable avatar presentation never claims unavailable WebGL is a 3D pass',()=>{
 assert.ok(verifier.includes("avatar.renderer==='static-fallback' && avatar.error"));
 assert.ok(verifier.includes('avatar.fallback.complete && avatar.fallback.visible && avatar.fallback.width>0 && avatar.fallback.height>0'));
 assert.ok(verifier.includes("avatar.fallback?.src==='/app-icon-512.png'"));
 assert.ok(!verifier.includes('MAIN_INSTALLED_GRAPHICS_PASS'));
 assert.ok(verifier.includes('not 3D proof'));
});

test('native passes isolate Chromium user data without changing native HOME',()=>{
 assert.ok(verifier.includes("'--user-data-dir='+path.join(temp,'electron-user-data')"));
 assert.ok(verifier.includes('MAIN_ONBOARDING_STORAGE'));
});
