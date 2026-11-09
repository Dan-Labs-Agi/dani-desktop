// Real published DEB upgrade in one disposable Linux profile.
const fs = require('node:fs');
const {ownedProfileFiles}=require('./owned-profile-files.cjs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const {chromium} = require(path.join(process.env.RUNNER_TEMP, 'smoke-tools/node_modules/playwright-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const temp = path.join(process.env.RUNNER_TEMP, 'dani-installed-verification');
// Isolate appData as well as product data. Only this disposable profile is read.
process.env.APPDATA=path.join(temp,'appdata');
process.env.LOCALAPPDATA=path.join(temp,'localappdata');
fs.mkdirSync(temp, {recursive:true});
const data = path.join(temp, 'profile');
fs.mkdirSync(data, {recursive:true});
// Installers may auto-launch the app. Give that first process the same disposable profile.
process.env.DANI_NATIVE_VERIFY='1';
process.env.DANI_DATA_DIR=data;
process.env.OMB_DATA_DIR=data;
// Windows resolves its profile through OS APIs too; isolate product/app data, not USERPROFILE.
if(process.platform!=='win32'){process.env.HOME=path.join(temp,'home');fs.mkdirSync(process.env.HOME,{recursive:true});}
fs.mkdirSync(process.env.APPDATA,{recursive:true});
fs.mkdirSync(process.env.LOCALAPPDATA,{recursive:true});

const phase=process.env.DANI_MIGRATION_PHASE;
assert.ok(['published','upgraded'].includes(phase),'migration phase must be explicit');
const executable=phase==='published' ? '/opt/Dani Bot/danibot' : '/opt/danibot/danibot';
const resources=path.join(path.dirname(executable),'resources');
const snapshot=path.join(temp,'published-state.json');
assert.ok(fs.existsSync(executable));assert.ok(fs.existsSync(path.join(resources,'server/index.js')));
let launched;
let launchOutput='';
function reportOwnedDiagnostics(){
 console.error('DANI_LAUNCH_OUTPUT',launchOutput.slice(-12000));
 for(const file of ownedProfileFiles(temp).filter(p=>/(?:server\.log|desktop-crashes\.log)$/.test(p))){
  try{console.error('DANI_OWNED_LOG',file,fs.readFileSync(path.join(temp,file),'utf8').slice(-16000));}catch{}
 }
 console.error('DANI_CHILD_STATE',JSON.stringify({exitCode:launched?.exitCode,signalCode:launched?.signalCode}));
}
function assertPreserved(actual,expected,label='state'){
 if(Array.isArray(expected)){assert.ok(Array.isArray(actual),label);assert.equal(actual.length,expected.length,label);expected.forEach((v,i)=>assertPreserved(actual[i],v,label+'['+i+']'));return;}
 if(expected&&typeof expected==='object'){assert.ok(actual&&typeof actual==='object',label);for(const [key,value] of Object.entries(expected))assertPreserved(actual[key],value,label+'.'+key);return;}
 assert.deepEqual(actual,expected,label);
}
function stop(){if(launched)try{process.kill(-launched.pid,'SIGKILL')}catch{}}
async function open() {
  launched=spawn(executable,['--remote-debugging-port=9333','--user-data-dir='+path.join(temp,'electron-user-data')],{env:{...process.env,DANI_DATA_DIR:data,OMB_DATA_DIR:data},stdio:['ignore','pipe','pipe'],detached:true});
  for(const stream of [launched.stdout,launched.stderr])stream.on('data',data=>{const text=data.toString();launchOutput=(launchOutput+text).slice(-20000);if(text.includes('DANI_NATIVE_PROFILE')||text.includes('DANI_NATIVE_SERVER'))console.log(text)});
  launched.on('error',error=>{launchOutput+='\n'+error.message});
  const deadline=Date.now()+120000;
  let browser;
  try {
    while(Date.now()<deadline){
      if(launched.exitCode!==null || launched.signalCode!==null)throw Error('Installed app exited before readiness');
      if(!browser){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9333',{timeout:3000});}catch{await sleep(500);continue;}}
      const page=browser.contexts().flatMap(c=>c.pages()).find(p=>/^http:\/\/127\.0\.0\.1:\d+/.test(p.url()));
      if(page){await page.waitForLoadState('domcontentloaded',{timeout:Math.max(1,deadline-Date.now())});return {browser,page};}
      await sleep(500);
    }
    throw Error('Installed app did not expose UI within120seconds');
  }catch(error){
    for(const [index,page] of (browser?.contexts().flatMap(c=>c.pages()).slice(0,2) ?? []).entries())await capture(page,'STARTUP_FAILURE_'+index).catch(()=>{});
    if(browser)await Promise.race([browser.close().catch(()=>{}),sleep(3000)]);
    throw error;
  }
}
async function capture(page,label) {
 await page.waitForTimeout(1500);
 const png=await page.screenshot({animations:'disabled',timeout:3000});
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
 assert.equal(status.body.app,phase==='published'?'danibot':'openmausbot','phase-specific packaged health identity');
 const skin=await page.evaluate(()=>document.documentElement.dataset.skin);
 if(phase==='upgraded')assert.equal(skin,'midnight','upgraded app must retain current dark design');
 const body=await page.locator('body').innerText();
 assert.ok(body.trim().length>10,'packaged renderer empty');
 console.log(JSON.stringify({event:label,health:status,visibleText:body.slice(0,2200),url:page.url()}));
 await capture(page,label);
}
async function persistedState(page){
 return page.evaluate(async()=>{
   const config=await fetch('/api/config').then(r=>r.json());
   const bots=await fetch('/api/bots').then(r=>r.json());
   const records=(bots.bots??bots).filter(b=>b.name==='Published migration test bot').map(b=>({id:b.id,name:b.name,threadId:b.threadId})).sort((a,b)=>a.id.localeCompare(b.id));
   const threads=[];
   for(const bot of records){
     const response=await fetch('/api/threads/'+encodeURIComponent(bot.threadId)+'/messages?limit=200');
     if(!response.ok)throw Error('Cannot read persisted migration thread: '+response.status);
     const body=await response.json();
     threads.push({threadId:bot.threadId,messages:body.messages??body});
   }
   return {profile:config.profile,bots:records,threads};
 });
}
(async()=>{
 stop();let ui=await open();await inspect(ui.page,'INSTALLED');
 if(phase==='published'){
   // The old UI has a different email/engine onboarding tour. Leave it intact.
   // This bot is saved by the real old API, never by editing its database.
   // An explicitly unavailable selection prevents any model process or call.
   const created=await ui.page.evaluate(async()=>{
     const r=await fetch('/api/bots',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Published migration test bot',modelSelection:{instanceId:'migration-no-provider',model:'migration-no-model'}})});
     return {status:r.status,body:await r.json()};
   });
   assert.equal(created.status,201,JSON.stringify(created));
   console.log('PUBLISHED_API_CREATED_TEST_BOT_NO_MODEL',JSON.stringify(created.body.bot?.id));
 }
 const state=await persistedState(ui.page);
 assert.equal(state.bots.length,1,'migration needs actual old-API persisted bot');
 if(phase==='published'){
   fs.writeFileSync(snapshot,JSON.stringify(state));
   fs.writeFileSync(path.join(data,'synthetic-preserved-marker.txt'),'preserve synthetic data');
 }else{
   assertPreserved(JSON.parse(JSON.stringify(state)),JSON.parse(fs.readFileSync(snapshot,'utf8')),'published profile/bot/thread preservation');
   assert.equal(fs.existsSync('/opt/Dani Bot/danibot'),false,'dpkg left old tracked executable behind');
   assert.equal(fs.realpathSync('/usr/bin/danibot'),executable,'CLI maps to wrong installation');
   assert.match(fs.readFileSync('/usr/share/applications/com.danibot.app.desktop','utf8'),/Exec=\/opt\/danibot\/danibot/);
   const bundledPolicy=fs.readFileSync(path.join(resources,'danibot-browser.apparmor'),'utf8');
   assert.ok(bundledPolicy.includes('/opt/danibot/'),'bundled AppArmor attachment lost the new root');
   assert.ok(!bundledPolicy.includes('/opt/Dani Bot/'),'bundled AppArmor retains old attachment');
   const restriction='/proc/sys/kernel/apparmor_restrict_unprivileged_userns';
   const restricted=fs.existsSync(restriction)?fs.readFileSync(restriction,'utf8').trim():'0';
   assert.ok(['0','1'].includes(restricted),'invalid OS restriction');
   const policyPath='/etc/apparmor.d/danibot-browser';
   if(fs.existsSync('/etc/apparmor.d/abi/4.0')||restricted==='1'){
     assert.equal(fs.readFileSync(policyPath,'utf8'),bundledPolicy,'installed AppArmor attachment differs');
     console.log('PUBLISHED_DEB_APPARMOR_OS_ATTACHMENT_PRESENT');
   }else console.log('PUBLISHED_DEB_APPARMOR_OS_OPTIONAL_SKIP_NO_ABI4_UNRESTRICTED');
   console.log('PUBLISHED_DEB_DPKG_CLI_DESKTOP_APPARMOR_STATE_PASS');
   // An old workspace can retain the new first-run overlay. Complete only
   // the real current tour if it is visible, without starting a model.
   if(await ui.page.locator('[data-welcome-later]').isVisible()){
     await ui.page.locator('[data-welcome-later]').click();
     await ui.page.locator('[data-chief-create]').waitFor({state:'visible',timeout:15000});
     await capture(ui.page,'UPGRADED_CHIEF');await sleep(1000);
     await ui.page.locator('[data-chief-create]').click();
     await ui.page.locator('[data-welcome]').waitFor({state:'detached',timeout:15000});
   }
   assert.ok((await ui.page.locator('body').innerText()).includes('Published migration test bot'),'migrated bot missing from real UI');
   await inspect(ui.page,'UPGRADED_EXISTING_WORKSPACE');
   assertPreserved(JSON.parse(JSON.stringify(await persistedState(ui.page))),JSON.parse(JSON.stringify(state)),'post-tour preservation');

 }
 await capture(ui.page,'PERSISTED_STATE');
 await ui.browser.close();stop();await sleep(3000);
 ui=await open();await inspect(ui.page,'RELAUNCHED');
 assertPreserved(JSON.parse(JSON.stringify(await persistedState(ui.page))),JSON.parse(JSON.stringify(state)),'relaunch preservation');
 assert.equal(fs.readFileSync(path.join(data,'synthetic-preserved-marker.txt'),'utf8'),'preserve synthetic data');
 if(phase==='upgraded')assert.equal(await ui.page.locator('[data-welcome]').count(),0,'new welcome reopened after completion');
 console.log('PUBLISHED_DEB_MIGRATION_'+phase.toUpperCase()+'_LAUNCH_STATE_RELAUNCH_PASS');await ui.browser.close();
})().catch(e=>{console.error(e.stack);reportOwnedDiagnostics();process.exitCode=1}).finally(()=>stop());
