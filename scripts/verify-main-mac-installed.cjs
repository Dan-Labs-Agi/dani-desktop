// Main architecture, disposable Intel Mac runner only. Exercise the installed app, not win-unpacked.
const fs = require('node:fs');
const {waitDaniFreeSetup}=require('./wait-dani-free-setup.cjs');
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
process.env.DANI_NATIVE_VERIFY='1';
process.env.DANI_DATA_DIR=data;
process.env.OMB_DATA_DIR=data;
// Windows resolves its profile through OS APIs too; isolate product/app data, not USERPROFILE.
// macOS Keychain resolves the native account's existing home. A fake HOME breaks
// safeStorage before startup; product state remains isolated by DANI/OMB_DATA_DIR.
if(process.platform!=='win32' && process.platform!=='darwin'){process.env.HOME=path.join(temp,'home');fs.mkdirSync(process.env.HOME,{recursive:true});}
fs.mkdirSync(process.env.APPDATA,{recursive:true});
fs.mkdirSync(process.env.LOCALAPPDATA,{recursive:true});
const marker = path.join(data, 'preserved-user-marker.txt');
fs.writeFileSync(marker, 'preserve synthetic customer data');
const installer=path.resolve('release',fs.readdirSync('release').find(f=>f.endsWith('-'+(process.arch==='arm64'?'arm64':'x64')+'.dmg'))||'missing.dmg');
console.log(JSON.stringify({event:'intel-candidate',source:process.env.GITHUB_SHA,sha256:createHash('sha256').update(fs.readFileSync(installer)).digest('hex'),bytes:fs.statSync(installer).size}));
const mount=path.join(temp,'mounted');fs.mkdirSync(mount,{recursive:true});
let result=spawnSync('hdiutil',['attach',installer,'-nobrowse','-mountpoint',mount],{encoding:'utf8',timeout:120000});assert.equal(result.status,0,result.stderr);
result=spawnSync('codesign',['--verify','--deep','--strict',path.join(mount,'Dani Bot.app')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
result=spawnSync('/usr/bin/ditto',[path.join(mount,'Dani Bot.app'),path.join(install,'Dani Bot.app')],{encoding:'utf8',timeout:120000});assert.equal(result.status,0,result.stderr);
require('./mac-installer-evidence.cjs').inspectMacInstaller({installer,mount,bundle:path.join(install,'Dani Bot.app'),directory:path.join(temp,'mac-installer-evidence')});
result=spawnSync('hdiutil',['detach',mount],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
const bundle=path.join(install,'Dani Bot.app');
const executable=path.join(bundle,'Contents/MacOS/Dani Bot');
result=spawnSync('codesign',['--verify','--deep','--strict',bundle],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
result=spawnSync('lipo',['-archs',executable],{encoding:'utf8'});assert.ok(result.stdout.includes(process.arch==='arm64'?'arm64':'x86_64'));
assert.ok(fs.existsSync(path.join(bundle,'Contents/Resources/server/index.js')));
let launched;
let launchOutput='';
function reportOwnedDiagnostics(){
 console.error('DANI_LAUNCH_OUTPUT',launchOutput.slice(-12000));
 for(const file of fs.readdirSync(temp,{recursive:true}).filter(p=>/(?:server\.log|desktop-crashes\.log)$/.test(p))){
  try{console.error('DANI_OWNED_LOG',file,fs.readFileSync(path.join(temp,file),'utf8').slice(-16000));}catch{}
 }
 // Electron's native macOS home/logs do not follow HOME. Read only the
 // product log directory it reported, never credentials or other native files.
 const profiles=[...launchOutput.matchAll(/DANI_NATIVE_PROFILE (\{[^\n]+\})/g)];
 for(const match of profiles.slice(-1)) {
  try {
   const profile=JSON.parse(match[1]);
   const expected=path.join(require('node:os').userInfo().homedir,'Library','Logs','danibot');
   if(profile.logs!==expected)throw Error('Unexpected native product logs path');
   for(const name of ['server.log','desktop-crashes.log']) {
    const file=path.join(profile.logs,name);
    if(fs.existsSync(file)) {
      const text=fs.readFileSync(file,'utf8').slice(-24000)
        .replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]')
        .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi,'$1[redacted]')
        .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/g,'$1?[redacted]');
      console.error('DANI_NATIVE_OWNED_LOG',name,text);
    }
   }
  } catch(error) {console.error('DANI_NATIVE_LOG_DIAGNOSTIC_ERROR',error.message);}
 }
 console.error('DANI_CHILD_STATE',JSON.stringify({exitCode:launched?.exitCode,signalCode:launched?.signalCode}));
}
const graphicsFailures=[];
function stop() {if(launched)try{process.kill(-launched.pid,'SIGKILL')}catch{}}
async function open() {
  launched=spawn(executable,['--remote-debugging-port=9333','--user-data-dir='+path.join(temp,'electron-user-data')],{env:{...process.env,DANI_DATA_DIR:data,OMB_DATA_DIR:data},stdio:['ignore','pipe','pipe'],detached:true});
  for(const stream of [launched.stdout,launched.stderr])stream.on('data',data=>{const text=data.toString();launchOutput=(launchOutput+text).slice(-20000);if(text.includes('DANI_NATIVE_PROFILE')||text.includes('DANI_NATIVE_SERVER')||text.includes('DANI_NATIVE_PHASE'))console.log(text)});
  launched.on('error',error=>{launchOutput+='\n'+error.message});
  const deadline=Date.now()+120000;
  let browser;
  try {
    while(Date.now()<deadline) {
      if(launched.exitCode!==null || launched.signalCode!==null) throw Error('Installed app exited before its UI was ready');
      if(!browser) {
        try {browser=await chromium.connectOverCDP('http://127.0.0.1:9333',{timeout:3000});}
        catch {await sleep(500);continue;}
      }
      const page=browser.contexts().flatMap(c=>c.pages()).find(p=> /^http:\/\/127\.0\.0\.1:\d+/.test(p.url()));
      if(page) {
        page.on('pageerror', error=>console.log('MAIN_RENDERER_ERROR',error.message));
        page.on('console', message=>{if(['error','warning'].includes(message.type())) console.log('MAIN_RENDERER_CONSOLE',message.type(),message.text().slice(0,2000));});
        await page.waitForLoadState('domcontentloaded',{timeout:Math.max(1,deadline-Date.now())});
        try {
          const cdp=await browser.newBrowserCDPSession();
          console.log('MAIN_GPU_INFO',JSON.stringify(await cdp.send('SystemInfo.getInfo')));
          await cdp.detach();
        } catch(error) {console.log('MAIN_GPU_DIAGNOSTIC_ERROR',error.message);}
        return {browser,page};
      }
      await sleep(500);
    }
    throw Error('Installed app did not expose its local UI within120seconds');
  } catch(error) {
    if(browser) {
      for(const [index,page] of browser.contexts().flatMap(c=>c.pages()).slice(0,2).entries()) {
        try {console.log('MAIN_STARTUP_PAGE',JSON.stringify({index,url:page.url().startsWith('http://127.0.0.1:') ? page.url().split('?')[0].slice(0,160) : 'non-local-startup-page'}));await capture(page,'STARTUP_FAILURE_'+index);}
        catch(captureError) {console.log('MAIN_STARTUP_CAPTURE_ERROR',captureError.message);}
      }
      await Promise.race([browser.close().catch(()=>{}),sleep(3000)]);
    }
    const desktop=path.join(temp,'startup-failure-desktop.png');
    const taken=spawnSync('/usr/sbin/screencapture',['-x',desktop],{encoding:'utf8',timeout:10000});
    if(taken.status===0) {
      const b64=fs.readFileSync(desktop).toString('base64');
      for(let i=0;i<b64.length;i+=32000)console.log('MAIN_STARTUP_DESKTOP_SCREENSHOT_CHUNK:'+b64.slice(i,i+32000));
      console.log('MAIN_STARTUP_DESKTOP_SCREENSHOT_END');
    }
    throw error;
  }
}

async function capture(page,label) {
 await page.waitForTimeout(1500);
 const png=await page.screenshot({animations:'disabled',timeout:3000});const b64=png.toString('base64');
 for(let i=0;i<b64.length;i+=32000) console.log('MAIN_'+label+'_SCREENSHOT_CHUNK:'+b64.slice(i,i+32000));
 console.log('MAIN_'+label+'_SCREENSHOT_END');
}
async function inspect(page,label) {
 await page.waitForTimeout(7000);
 const status=await page.evaluate(async()=>{const r=await fetch('/api/health');return {code:r.status,body:await r.json()}});
 assert.equal(status.code,200,'packaged server health unavailable');
 assert.equal(status.body.app,'openmausbot','expected retained health wire identity');
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.skin),'midnight');
 const body=await page.locator('body').innerText();
 assert.ok(body.trim().length>10,'packaged renderer empty');
 console.log(JSON.stringify({event:label,health:status,visibleText:body.slice(0,2200),url:page.url()}));
 console.log('MAIN_ONBOARDING_STORAGE',JSON.stringify(await page.evaluate(async()=>({onboarding:(await (await fetch('/api/config')).json()).onboarding,legacyKeys:Object.keys(localStorage).filter(key=>/welcome|onboard/i.test(key)).map(key=>({key,value:localStorage.getItem(key)}))}))));
 await capture(page,label);
 const graphics=await page.evaluate(()=>({
   avatars:[...document.querySelectorAll('[data-robot-renderer]')].map(element=>({renderer:element.getAttribute('data-robot-renderer'),error:element.getAttribute('data-robot-error'),role:element.getAttribute('data-robot-role'),fallback: (()=>{const image=element.querySelector('img.mz-robot-static-fallback');const bounds=image?.getBoundingClientRect();const style=image ? getComputedStyle(image) : null;return image ? {visible:Boolean(bounds && bounds.width>0 && bounds.height>0 && style.visibility!=='hidden' && style.display!=='none' && style.opacity!=='0'),src:image.getAttribute('src'),complete:image.complete,width:image.naturalWidth,height:image.naturalHeight} : null;})()})),
   webgl2:Boolean(document.createElement('canvas').getContext('webgl2')),
 }));
 console.log('MAIN_GRAPHICS_STATUS',label,JSON.stringify(graphics));
 graphicsFailures.push(...graphics.avatars.filter(avatar=>avatar.renderer!=='webgl' && !(avatar.renderer==='static-fallback' && avatar.error && avatar.fallback?.src==='/app-icon-512.png' && avatar.fallback.complete && avatar.fallback.visible && avatar.fallback.width>0 && avatar.fallback.height>0)).map(avatar=>({label,...avatar})));
}
(async()=>{
 stop();let ui=await open();await inspect(ui.page,'INSTALLED');
 if(process.env.DANI_VERIFY_FREE_INSTALL==='1') {
   const button=ui.page.locator('[data-dani-free-install]');await button.waitFor({state:'visible'});
   assert.equal(await button.innerText(),'Install Dani Free');await button.click();
   console.log('DANI_FREE_FINAL_STATUS',JSON.stringify(await waitDaniFreeSetup(ui.page)));
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
 assert.equal(graphicsFailures.length,0,'installed avatar rendering incomplete: '+JSON.stringify(graphicsFailures));
 console.log('MAIN_INSTALLED_AVATAR_PRESENTATION_PASS');
 console.log('MAIN_GRAPHICS_ACCEPTANCE usable approved avatar required; WebGL or decoded static fallback is reported per surface, not 3D proof');
})().catch(e=>{console.error(e.stack);reportOwnedDiagnostics();process.exitCode=1}).finally(()=>stop());
