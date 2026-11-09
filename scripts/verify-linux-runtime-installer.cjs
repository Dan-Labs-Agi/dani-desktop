// Disposable Ubuntu test VM only. Exercise the installed app, not win-unpacked.
const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');
assert.equal(process.platform,'linux','Run this verifier only on a disposable Ubuntu runner');
assert.ok(process.env.RUNNER_TEMP,'RUNNER_TEMP is required');
const {chromium} = require(path.join(process.env.RUNNER_TEMP, 'smoke-tools/node_modules/playwright-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const temp = process.env.DANI_INSTALLER_VERIFICATION_ROOT
  ? path.resolve(process.env.DANI_INSTALLER_VERIFICATION_ROOT)
  : fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'dani-installed-verification-'));
fs.mkdirSync(temp,{recursive:true});
assert.equal(fs.readdirSync(temp).length,0,'verification fixture root must be empty');
const evidence = process.env.DANI_NATIVE_EVIDENCE_DIR ? path.resolve(process.env.DANI_NATIVE_EVIDENCE_DIR) : null;
if(evidence) fs.mkdirSync(evidence,{recursive:true});
function record(event,details) {
  const entry={event,...details};
  console.log(JSON.stringify(entry));
  if(evidence) fs.writeFileSync(path.join(evidence,event+'.json'),JSON.stringify(entry,null,2)+'\n');
}
process.env.HOME=path.join(temp,'home');
process.env.USERPROFILE=process.env.HOME;
process.env.HERMES_HOME=path.join(temp,'hermes-home');
process.env.XDG_CONFIG_HOME=path.join(temp,'config');
process.env.XDG_CACHE_HOME=path.join(temp,'cache');
process.env.XDG_DATA_HOME=path.join(temp,'share');
process.env.APPDATA=path.join(temp,'appdata');
process.env.LOCALAPPDATA=path.join(temp,'localappdata');
const data = path.join(temp, 'profile');
process.env.DANI_DATA_DIR=data;
process.env.OMB_DATA_DIR=data;
for(const directory of [data,process.env.HOME,process.env.HERMES_HOME,process.env.XDG_CONFIG_HOME,process.env.XDG_CACHE_HOME,process.env.XDG_DATA_HOME,process.env.APPDATA,process.env.LOCALAPPDATA]) fs.mkdirSync(directory,{recursive:true});
const marker = path.join(data, 'preserved-user-marker.txt');
const markerValue = 'preserve synthetic customer data';
fs.writeFileSync(marker, markerValue);
const candidates=fs.readdirSync('release').filter(f=>f.endsWith('-amd64.deb'));
assert.equal(candidates.length,1,'expected exactly one amd64 DEB installer in release/');
const installer=path.resolve('release',candidates[0]);
record('linux-candidate',{source:process.env.GITHUB_SHA,installer,profile:data,sha256:createHash('sha256').update(fs.readFileSync(installer)).digest('hex'),bytes:fs.statSync(installer).size});
const result=spawnSync('sudo',['apt-get','install','-y',installer],{encoding:'utf8',timeout:240000});
console.log(result.stdout);assert.equal(result.status,0,'DEB install failed: '+(result.error?.message || result.signal || result.stderr));
const executable='/opt/Dani Bot/danibot';
const resources='/opt/Dani Bot/resources';
assert.ok(fs.existsSync(executable),'DEB executable missing');
assert.ok(fs.existsSync(path.join(resources,'server/index.js')),'installed packaged server missing');
// Synthetic diagnostic bundle stays outside the signed app.
const diag=spawnSync(process.execPath,[path.resolve('dist-native/runtime-diagnosis.mjs'),resources],{env:process.env,encoding:'utf8',timeout:300000});
console.log(diag.stdout);console.error(diag.stderr);
record('runtime-diagnosis',{exitCode:diag.status,signal:diag.signal,error:diag.error?.message});
if(evidence) fs.writeFileSync(path.join(evidence,'runtime-diagnosis.log'),(diag.stdout || '')+(diag.stderr || ''));
assert.equal(diag.status,0,'isolated diagnosis process failed: '+(diag.error?.message || diag.signal || diag.stderr));
let launched;
function stop() {
  if(launched?.pid)try{process.kill(-launched.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
}
async function open() {
  let launchError;
  launched=spawn(executable,['--remote-debugging-port=9333'],{env:process.env,stdio:'ignore',detached:true});
  launched.once('error',error=>{launchError=error;});
  const deadline=Date.now()+120000;
  let browser,lastError;
  while(Date.now()<deadline) {
    if(launchError) throw launchError;
    if(launched.exitCode!==null || launched.signalCode!==null) throw Error('installed app exited before its UI became reachable');
    if(!browser) {
      try {browser=await chromium.connectOverCDP('http://127.0.0.1:9333',{timeout:5000});}
      catch(error) {lastError=error;await sleep(1000);continue;}
    }
    const page=browser.contexts().flatMap(c=>c.pages()).find(p=> /^http:\/\/127\.0\.0\.1:\d+/.test(p.url()));
    if(page) {await page.waitForLoadState('domcontentloaded',{timeout:10000}); return {browser,page};}
    await sleep(1000);
  }
  throw Error('packaged UI not reachable within 120 seconds: '+(lastError?.message || 'no loopback app page'));
}
function ready(status) {
  return status.state==='ready' && status.readiness?.taskReady===true &&
    status.readiness?.runtime?.hermes===true && status.readiness?.runtime?.opencode===true &&
    status.readiness?.modelRoute?.state==='ready' && !status.error;
}
async function bootstrap(page,method='GET') {
  return page.evaluate(async method=>{
    const response=await fetch('/api/runtime/bootstrap',{method,signal:AbortSignal.timeout(15000),
      ...(method==='POST'?{headers:{'content-type':'application/json'},body:'{}'}:{})});
    if(response.status!==(method==='POST'?202:200)) throw Error('bootstrap HTTP '+response.status);
    return response.json();
  },method);
}
async function runtime(page, retry) {
  if(retry) await bootstrap(page,'POST');
  let status;
  const deadline=Date.now()+360000;
  while(Date.now()<deadline) {
    status=await bootstrap(page);
    if(ready(status)) {
      // Require stable readiness, then let the real renderer leave preparation.
      await sleep(3500);
      const stable=await bootstrap(page);
      if(ready(stable)) return stable;
      status=stable;
    }
    if(status.state==='blocked-error' || (status.state==='repairable-error' && status.error?.code!=='not-activated')) break;
    await sleep(1000);
  }
  try {await capture(page,'FAILURE',status);} catch(error) {console.error('FAILURE_CAPTURE_ERROR',error.message);}
  const logfile=path.join(process.env.XDG_CONFIG_HOME,'Dani Bot/logs/server.log');
  if(fs.existsSync(logfile)) {
    const lines=fs.readFileSync(logfile,'utf8').split('\n');
    console.log('SYNTHETIC_PROFILE_SERVER_ERRORS',lines.filter(l=>/error|failed|exit|model|route/i.test(l)).map(l=>l.replace(/(token|key|secret)[:=][^\s,]+/gi,'$1=[redacted]')).slice(-35).join('\n'));
  }
  throw Error('installed runtime did not verify: '+JSON.stringify(status));
}
async function capture(page,label,status) {
  if(evidence) fs.writeFileSync(path.join(evidence,label+'.json'),JSON.stringify(status,null,2)+'\n');
  await page.waitForTimeout(2000);
  const png=await page.screenshot({timeout:15000});
  if(evidence) {
    const screenshot=path.join(evidence,label+'.png');
    fs.writeFileSync(screenshot,png);
    record('screenshot-'+label,{screenshot});
    return;
  }
  const b64=png.toString('base64');
  for(let i=0;i<b64.length;i+=32000) console.log('SCREENSHOT_'+label+'_CHUNK:'+b64.slice(i,i+32000));
  console.log('SCREENSHOT_'+label+'_END');
}
const watchdog=setTimeout(()=>{
  record('verification-failed',{message:'installed verification exceeded its 30 minute deadline'});
  stop();process.exit(1);
},30*60*1000);
watchdog.unref();
(async()=> {
  stop();
  let ui=await open();
  record('installed-launch',{url:ui.page.url()});
  const first=await runtime(ui.page,true);
  record('installed-runtime-verified',{status:first});
  assert.equal(fs.readFileSync(marker,'utf8'),markerValue,'first launch changed user data');
  await capture(ui.page,'INSTALL',first);
  const pointer=path.join(data,'managed-runtimes/hermes/current.json');
  const active=JSON.parse(fs.readFileSync(pointer,'utf8'));
  await ui.browser.close();stop();await sleep(3000);
  ui=await open();
  const recovered=await runtime(ui.page,false);
  assert.deepEqual(JSON.parse(fs.readFileSync(pointer,'utf8')),active,'relaunch replaced the verified activation');
  assert.equal(fs.readFileSync(marker,'utf8'),markerValue,'relaunch changed user data');
  record('relaunch-runtime-verified',{status:recovered,activationPreserved:true,userMarkerPreserved:true});
  await capture(ui.page,'RELAUNCH',recovered);
  await ui.browser.close();stop();await sleep(3000);
  const manifest=JSON.parse(fs.readFileSync(path.join(resources,'managed-runtimes/manifests/hermes-linux-x64.manifest.json'),'utf8'));
  const oldNotice=path.join(data,'managed-runtimes/hermes',active.installation,manifest.noticeRelPath);
  assert.ok(fs.existsSync(oldNotice),'expected legal notice missing');
  const original=fs.readFileSync(oldNotice);
  // Change permissions only on this disposable activation to simulate damage.
  fs.chmodSync(oldNotice,0o600);
  const damaged=Buffer.concat([original,Buffer.from('\nsynthetic damage')]);
  fs.writeFileSync(oldNotice,damaged);
  ui=await open();
  const repaired=await runtime(ui.page,true);
  const next=JSON.parse(fs.readFileSync(pointer,'utf8'));
  assert.notEqual(next.installation,active.installation,'damaged installation reused');
  assert.deepEqual(fs.readFileSync(oldNotice),damaged,'previous activation changed or was deleted');
  assert.deepEqual(fs.readFileSync(path.join(data,'managed-runtimes/hermes',next.installation,manifest.noticeRelPath)),original,'repair did not restore signed payload bytes');
  assert.equal(fs.readFileSync(marker,'utf8'),markerValue);
  record('installed-retry-verified',{status:repaired,userMarkerPreserved:true,oldActivationPreserved:true,repairedPayloadRestored:true});
  await capture(ui.page,'REPAIR',repaired);
  await ui.browser.close();
})().catch(e=> {
  console.error(e.stack);record('verification-failed',{message:e.message});process.exitCode=1;
}).finally(()=>{
  stop();clearTimeout(watchdog);
  if(process.exitCode) process.exit(process.exitCode);
});
