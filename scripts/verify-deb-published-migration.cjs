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
 assert.equal(status.body.app,'openmausbot','expected retained health wire identity');
 const skin=await page.evaluate(()=>document.documentElement.dataset.skin);
 if(phase==='upgraded')assert.equal(skin,'midnight','upgraded app must retain current dark design');
 const body=await page.locator('body').innerText();
 assert.ok(body.trim().length>10,'packaged renderer empty');
 console.log(JSON.stringify({event:label,health:status,visibleText:body.slice(0,2200),url:page.url()}));
 await capture(page,label);
}
(async()=>{
 stop();let ui=await open();await inspect(ui.page,'INSTALLED');
 if(phase==='published'){
 await ui.page.locator('[data-welcome-later]').click();
 await ui.page.locator('[data-chief-create]').waitFor({state:'visible',timeout:15000});
 await capture(ui.page,'CHIEF');
 await ui.page.waitForTimeout(1000); // Respect the real Chief intro's accidental-click guard.
 await ui.page.locator('[data-chief-create]').click();
 await ui.page.locator('[data-welcome]').waitFor({state:'detached',timeout:15000});
 }
 await inspect(ui.page,'ONBOARDED');
 const onboarding=await ui.page.evaluate(async()=>{const r=await fetch('/api/config');const c=await r.json();return {code:r.status,onboarding:c.onboarding}});
 console.log('MAIN_ONBOARDING_CONFIG',JSON.stringify(onboarding));
 assert.equal(onboarding.code,200);assert.ok(onboarding.onboarding?.completedAt,'onboarding completion missing');
 const state=await ui.page.evaluate(async()=>{
   const config=await fetch('/api/config').then(r=>r.json());
   const bots=await fetch('/api/bots').then(r=>r.json());
   const records=(bots.bots??bots).map(b=>({id:b.id,name:b.name,threadId:b.threadId})).sort((a,b)=>a.id.localeCompare(b.id));
   const threads=[];
   for(const bot of records){
     const response=await fetch('/api/threads/'+encodeURIComponent(bot.threadId)+'/messages?limit=200');
     if(!response.ok)throw Error('Cannot read persisted migration thread: '+response.status);
     const body=await response.json();
     threads.push({threadId:bot.threadId,messages:(body.messages??body).map(m=>({id:m.id,role:m.role,kind:m.kind,text:m.text}))});
   }
   return {onboarding:config.onboarding,bots:records,threads};
 });
 assert.ok(state.bots.length>0,'migration needs actual persisted bots');
 if(phase==='published'){
   fs.writeFileSync(snapshot,JSON.stringify(state));
   fs.writeFileSync(path.join(data,'synthetic-preserved-marker.txt'),'preserve synthetic data');
 }else{
   assert.deepEqual(state,JSON.parse(fs.readFileSync(snapshot,'utf8')),'published onboarding/bot identity changed during upgrade');
   assert.equal(fs.existsSync('/opt/Dani Bot/danibot'),false,'dpkg left old tracked executable behind');
   assert.equal(fs.realpathSync('/usr/bin/danibot'),executable,'CLI maps to wrong installation');
   assert.match(fs.readFileSync('/usr/share/applications/com.danibot.app.desktop','utf8'),/Exec=\/opt\/danibot\/danibot/);
 }
 await ui.browser.close();stop();await sleep(3000);
 ui=await open();await inspect(ui.page,'RELAUNCHED');
 assert.equal(fs.readFileSync(path.join(data,'synthetic-preserved-marker.txt'),'utf8'),'preserve synthetic data');
 assert.equal(await ui.page.locator('[data-welcome]').count(),0,'completed welcome reopened on relaunch');
 console.log('PUBLISHED_DEB_MIGRATION_'+phase.toUpperCase()+'_LAUNCH_STATE_RELAUNCH_PASS');await ui.browser.close();
})().catch(e=>{console.error(e.stack);reportOwnedDiagnostics();process.exitCode=1}).finally(()=>stop());
