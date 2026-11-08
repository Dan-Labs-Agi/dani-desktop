// Main architecture, disposable Windows runner only. Exercise the installed app, not win-unpacked.
const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');
const {chromium} = require(path.join(process.env.RUNNER_TEMP, 'smoke-tools/node_modules/playwright-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const temp = path.join(process.env.RUNNER_TEMP, 'dani-installed-verification');
// Isolate appData as well as product data. Only this disposable profile is read.
process.env.APPDATA=path.join(temp,'appdata');
process.env.LOCALAPPDATA=path.join(temp,'localappdata');
fs.mkdirSync(temp, {recursive:true});
const install = path.join(temp, 'app');
const data = path.join(temp, 'profile');
fs.mkdirSync(data, {recursive:true});
// Installers may auto-launch the app. Give that first process the same disposable profile.
process.env.DANI_DATA_DIR=data;
process.env.OMB_DATA_DIR=data;
process.env.HOME=path.join(temp,'home');
process.env.USERPROFILE=process.env.HOME;
fs.mkdirSync(process.env.HOME,{recursive:true});
const marker = path.join(data, 'preserved-user-marker.txt');
fs.writeFileSync(marker, 'preserve synthetic customer data');
const installer = path.resolve('release', fs.readdirSync('release').find(f => /^DaniBot-.*-setup\.exe$/.test(f)) || 'missing-installer.exe');
const sha = createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
console.log(JSON.stringify({event:'candidate', source:process.env.GITHUB_SHA, sha256:sha, bytes:fs.statSync(installer).size}));
const result = spawnSync(installer, ['/S', '/D='+install], {timeout:180000,encoding:'utf8'});
assert.equal(result.status,0, 'NSIS install failed: '+result.stderr);
const executable = path.join(install, 'Dani Bot.exe');
assert.ok(fs.existsSync(executable),'installer did not install expected app');
assert.ok(fs.existsSync(path.join(install,'resources/server/index.js')),'installed packaged server missing');
const update=fs.readFileSync(path.join(install,'resources/app-update.yml'),'utf8');
assert.match(update,/^owner: Dan-Labs-Agi$/m,'installed updater has the wrong organization');
assert.match(update,/^repo: dani-desktop$/m,'installed updater has the wrong repository');
let launched;
function stop() {
  if (launched) spawnSync('taskkill', ['/PID', String(launched.pid), '/T', '/F'], {encoding:'utf8'});
  // NSIS or Electron may already have launched an independent sibling in this disposable VM.
  spawnSync('taskkill', ['/IM','Dani Bot.exe','/T','/F'], {encoding:'utf8'});
}
async function open() {
  launched=spawn(executable,['--remote-debugging-port=9333'],{env:{...process.env,DANI_DATA_DIR:data,OMB_DATA_DIR:data},stdio:'ignore'});
  for(let i=0;i<120;i++) {
    try {const browser=await chromium.connectOverCDP('http://127.0.0.1:9333');
      for(let j=0;j<90;j++) {
        const page=browser.contexts().flatMap(c=>c.pages()).find(p=> /^http:\/\/127\.0\.0\.1:\d+/.test(p.url()));
        if(page) {await page.waitForLoadState('domcontentloaded'); return {browser,page};}
        await sleep(1000);
      }
      throw Error('packaged UI not reachable');
    }catch(e){if(i===119)throw e;await sleep(1000);}
  }
}
async function capture(page,label) {
 await page.waitForTimeout(1500);
 const png=await page.screenshot({animations:'disabled'});
 if(process.env.DANI_EVIDENCE_DIR) {
   fs.mkdirSync(process.env.DANI_EVIDENCE_DIR,{recursive:true});
   fs.writeFileSync(path.join(process.env.DANI_EVIDENCE_DIR,label+'.png'),png);
   return;
 }
 const b64=png.toString('base64');
 for(let i=0;i<b64.length;i+=32000) console.log('MAIN_'+label+'_SCREENSHOT_CHUNK:'+b64.slice(i,i+32000));
 console.log('MAIN_'+label+'_SCREENSHOT_END');
}
async function inspect(page,label) {
 await page.waitForTimeout(7000);
 const status=await page.evaluate(async()=>{const r=await fetch('/api/health');return {code:r.status,body:await r.json()}});
 assert.equal(status.code,200,'packaged server health unavailable');
 assert.equal(status.body.app,'openmausbot','expected retained health wire identity');
 const skin=await page.evaluate(()=>document.documentElement.dataset.skin);
 assert.equal(skin,'midnight','fresh installer must retain the approved dark Dani design');
 const body=await page.locator('body').innerText();
 assert.ok(body.trim().length>10,'packaged renderer empty');
 console.log(JSON.stringify({event:label,health:status,visibleText:body.slice(0,2200),url:page.url()}));
 await capture(page,label);
}
(async()=>{
 stop();let ui=await open();await inspect(ui.page,'INSTALLED');
 if(process.env.DANI_VERIFY_FREE_INSTALL==='1') {
   const button=ui.page.locator('[data-dani-free-install]');await button.waitFor({state:'visible'});
   assert.equal(await button.innerText(),'Install Dani Free');await button.click();
   await ui.page.waitForFunction(async()=>{const r=await fetch('/api/instances/dani-free/setup');const s=await r.json();if(s.phase==='failed')throw Error(s.message);return s.phase==='installed';},null,{timeout:240000});
   await capture(ui.page,'FREE_INSTALLED');
   const isolatedFiles=fs.readdirSync(temp,{recursive:true}).filter(p=>/(?:config\.json|server\.log|runtime\.json|cua-local-control\.json)$/.test(p));
   console.log('DANI_ISOLATED_PROFILE_FILES',JSON.stringify(isolatedFiles));
   assert.ok(fs.existsSync(path.join(data,'config.json')),'setup reported installed without config in the explicitly isolated profile');
   const config=JSON.parse(fs.readFileSync(path.join(data,'config.json'),'utf8'));
   assert.equal(config.instances.daniFree.driver,'dani-free');
   assert.equal(fs.existsSync(path.join(data,'dani-free/runtime.json')),false,'install must not start a model service');
   console.log('DANI_FREE_PACKAGED_BUTTON_INSTALL_PASS');
 }
 await ui.page.locator('[data-welcome-later]').click();
 await ui.page.locator('[data-chief-create]').waitFor({state:'visible',timeout:15000});
 await capture(ui.page,'CHIEF');
 await ui.page.waitForTimeout(1000); // Respect the real Chief intro's accidental-click guard.
 await ui.page.locator('[data-chief-create]').click();
 await ui.page.locator('[data-welcome]').waitFor({state:'detached',timeout:15000});
 await inspect(ui.page,'ONBOARDED');
 const onboarding=await ui.page.evaluate(async()=>{const r=await fetch('/api/config');const c=await r.json();return {code:r.status,onboarding:c.onboarding}});
 console.log('MAIN_ONBOARDING_CONFIG',JSON.stringify(onboarding));
 assert.equal(onboarding.code,200);assert.ok(onboarding.onboarding?.completedAt,'onboarding completion missing');
 fs.writeFileSync(path.join(data,'synthetic-preserved-marker.txt'),'preserve synthetic data');
 await ui.browser.close();stop();await sleep(3000);
 ui=await open();await inspect(ui.page,'RELAUNCHED');
 assert.equal(fs.readFileSync(path.join(data,'synthetic-preserved-marker.txt'),'utf8'),'preserve synthetic data');
 assert.equal(await ui.page.locator('[data-welcome]').count(),0,'completed welcome reopened on relaunch');
 console.log('MAIN_INSTALLED_RELAUNCH_PASS');await ui.browser.close();
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>stop());
