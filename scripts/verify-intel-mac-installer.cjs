// Disposable native macOS runner only. Exercise the installed app, not win-unpacked.
const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');
const {chromium} = require(path.join(process.env.RUNNER_TEMP, 'smoke-tools/node_modules/playwright-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const temp = process.env.DANI_INSTALLER_VERIFICATION_ROOT || fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'dani-installed-verification-'));
if (fs.existsSync(temp) && fs.readdirSync(temp).length) throw new Error('Installer verification requires an empty fixture directory');
const home = path.join(temp, 'home');
const evidence = process.env.DANI_NATIVE_EVIDENCE_DIR || path.join(temp, 'evidence');
for (const directory of [temp, home, evidence]) fs.mkdirSync(directory, {recursive:true});
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.APPDATA = path.join(temp, 'appdata');
process.env.LOCALAPPDATA = path.join(temp, 'localappdata');
process.env.XDG_CONFIG_HOME = path.join(home, '.config');
process.env.XDG_CACHE_HOME = path.join(home, '.cache');
process.env.XDG_DATA_HOME = path.join(home, '.local', 'share');
const install = path.join(temp, 'app');
const data = path.join(temp, 'profile');
fs.mkdirSync(data, {recursive:true});
process.env.DANI_DATA_DIR = data;
process.env.OMB_DATA_DIR = data;
process.env.HERMES_HOME = path.join(temp, 'hermes-home');
const marker = path.join(data, 'preserved-user-marker.txt');
fs.writeFileSync(marker, 'preserve synthetic customer data');
const installer=path.resolve('release',fs.readdirSync('release').find(f=>f.endsWith('-'+process.arch+'.dmg'))||'missing.dmg');
console.log(JSON.stringify({event:'intel-candidate',source:process.env.GITHUB_SHA,sha256:createHash('sha256').update(fs.readFileSync(installer)).digest('hex'),bytes:fs.statSync(installer).size}));
const mount=path.join(temp,'mounted');fs.mkdirSync(mount,{recursive:true});
let result=spawnSync('hdiutil',['attach',installer,'-readonly','-nobrowse','-mountpoint',mount],{encoding:'utf8',timeout:120000});
assert.equal(result.status,0,result.stderr);
result=spawnSync('codesign',['--verify','--deep','--strict',path.join(mount,'Dani Bot.app')],{encoding:'utf8'});assert.equal(result.status,0,'mounted DMG signature: '+result.stderr);
// Finder-style bundle copy preserves framework-relative symlinks and metadata.
result=spawnSync('/usr/bin/ditto',[path.join(mount,'Dani Bot.app'),path.join(install,'Dani Bot.app')],{encoding:'utf8',timeout:120000});assert.equal(result.status,0,result.stderr);
require('./mac-installer-evidence.cjs').inspectMacInstaller({installer,mount,bundle:path.join(install,'Dani Bot.app'),directory:path.join(evidence,'bundle')});
result=spawnSync('hdiutil',['detach',mount],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
const bundle=path.join(install,'Dani Bot.app');
const executable=path.join(bundle,'Contents/MacOS/Dani Bot');
result=spawnSync('codesign',['--verify','--deep','--strict',bundle],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
result=spawnSync('lipo',['-archs',executable],{encoding:'utf8'});assert.ok(result.stdout.includes(process.arch==='arm64'?'arm64':'x86_64'),'app architecture does not match host');
const resources=path.join(bundle,'Contents/Resources');
assert.ok(fs.existsSync(path.join(resources,'server/index.js')),'installed packaged server missing');
for(const kind of ['hermes','opencode']) {
 const manifest=JSON.parse(fs.readFileSync(path.join(resources,'managed-runtimes','manifests',kind+'-darwin-'+process.arch+'.manifest.json'),'utf8'));
 assert.equal(manifest.target,'darwin-'+process.arch,'bundled runtime target mismatch');
 console.log('INSTALLED_RUNTIME_MANIFEST',kind,manifest.target,manifest.archiveSha256);
}

// Synthetic diagnostic bundle stays outside the signed app.
const diag=spawnSync(process.execPath,[path.resolve('dist-native/runtime-diagnosis.mjs'),resources],{env:process.env,encoding:'utf8',timeout:300000});
console.log(diag.stdout);console.error(diag.stderr);assert.equal(diag.status,0,'isolated diagnosis process failed');
let launched;
function stop() {
  if(launched)try{process.kill(-launched.pid,'SIGKILL');}catch{}
}
async function open() {
  launched=spawn(executable,['--remote-debugging-port=9333'],{env:process.env,stdio:'ignore',detached:true});
  const deadline = Date.now() + 120000;
  let connected;
  while (Date.now() < deadline) {
    if (launched.exitCode !== null) throw new Error('Installed app exited before its UI was reachable');
    try {
      connected ??= await chromium.connectOverCDP('http://127.0.0.1:9333', {timeout:5000});
      const page=connected.contexts().flatMap(c=>c.pages()).find(p=> /^http:\/\/127\.0\.0\.1:\d+/.test(p.url()));
      if (page) {
        await page.waitForLoadState('domcontentloaded', {timeout:10000});
        page.setDefaultTimeout(10000);
        return {browser:connected,page};
      }
    } catch {
      if (connected) await connected.close().catch(()=>{});
      connected = null;
    }
    await sleep(1000);
  }
  throw new Error('Installed app UI was not reachable within 120 seconds');
}
const ready = status => status.state==='ready' && status.readiness?.taskReady && status.readiness?.runtime?.hermes && status.readiness?.runtime?.opencode && status.readiness?.modelRoute?.state==='ready' && status.error===null;
async function runtime(page, retry) {
  if(retry) {
    const code=await page.evaluate(async()=> (await fetch('/api/runtime/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)})).status);
    assert.equal(code,202,'normal renderer bootstrap request denied');
  }
  let status;
  for(let i=0;i<300;i++) {
    status=await page.evaluate(async()=> (await fetch('/api/runtime/bootstrap',{signal:AbortSignal.timeout(10000)})).json());
    if(ready(status)) {
      await sleep(3500);
      const stable=await page.evaluate(async()=> (await fetch('/api/runtime/bootstrap', {signal:AbortSignal.timeout(10000)})).json());
      if(ready(stable)) return stable;
      status=stable;
    }
    if(status.state==='blocked-error' || (status.state==='repairable-error' && status.error?.code!=='not-activated')) break;
    await sleep(1000);
  }
  await capture(page,'FAILURE');
  const logfile=path.join(process.env.HOME,'Library/Logs/Dani Bot/server.log');
  if(fs.existsSync(logfile)) {
    const lines=fs.readFileSync(logfile,'utf8').split('\n');
    console.log('SYNTHETIC_PROFILE_SERVER_ERRORS',lines.filter(l=>/error|failed|exit|model|route/i.test(l)).map(l=>l.replace(/(token|key|secret)[:=][^\s,]+/gi,'$1=[redacted]')).slice(-35).join('\n'));
  }
  throw Error('installed runtime did not verify: '+JSON.stringify(status));
}
async function capture(page,label) {
  await page.waitForTimeout(2000);
  const image = path.join(evidence, label + '.png');
  const status = await page.evaluate(async()=> (await fetch('/api/runtime/bootstrap', {signal:AbortSignal.timeout(10000)})).json());
  await page.screenshot({path:image,timeout:15000});
  fs.writeFileSync(path.join(evidence, label + '.json'), JSON.stringify(status, null, 2) + '\n');
  console.log(JSON.stringify({event:'native-screenshot',label,file:image}));
}
const watchdog = setTimeout(()=>{console.error('Native installer verification exceeded 30 minutes');stop();process.exit(1);},30*60*1000);
watchdog.unref();
(async()=> {
  stop();
  let ui=await open();
  console.log(JSON.stringify({event:'installed-launch',url:ui.page.url()}));
  const first=await runtime(ui.page,true);
  console.log(JSON.stringify({event:'installed-runtime-verified',status:first}));
  await capture(ui.page,'INSTALL');
  const pointer=path.join(data,'managed-runtimes/hermes/current.json');
  const active=JSON.parse(fs.readFileSync(pointer,'utf8'));
  await ui.browser.close();stop();await sleep(3000);
  ui=await open();
  const recovered=await runtime(ui.page,false);
  console.log(JSON.stringify({event:'relaunch-runtime-verified',status:recovered}));
  assert.deepEqual(JSON.parse(fs.readFileSync(pointer,'utf8')),active,'relaunch replaced the verified activation');
  assert.equal(fs.readFileSync(marker,'utf8'),'preserve synthetic customer data');
  await capture(ui.page,'RELAUNCH');
  await ui.browser.close();stop();await sleep(3000);
  const manifest=JSON.parse(fs.readFileSync(path.join(resources,'managed-runtimes/manifests/hermes-darwin-'+process.arch+'.manifest.json'),'utf8'));
  const oldNotice=path.join(data,'managed-runtimes/hermes',active.installation,manifest.noticeRelPath);
  assert.ok(fs.existsSync(oldNotice),'expected legal notice missing');
  const original=fs.readFileSync(oldNotice);
  const damaged = Buffer.concat([original,Buffer.from('\nsynthetic damage')]);
  fs.chmodSync(oldNotice,0o600);
  fs.writeFileSync(oldNotice,damaged);
  ui=await open();
  const repaired=await runtime(ui.page,true);
  const next=JSON.parse(fs.readFileSync(pointer,'utf8'));
  assert.notEqual(next.installation,active.installation,'damaged installation reused');
  assert.deepEqual(fs.readFileSync(oldNotice),damaged,'previous activation changed during repair');
  assert.deepEqual(fs.readFileSync(path.join(data,'managed-runtimes/hermes',next.installation,manifest.noticeRelPath)),original,'repair did not restore the bundled bytes');
  assert.equal(fs.readFileSync(marker,'utf8'),'preserve synthetic customer data');
  console.log(JSON.stringify({event:'installed-retry-verified',status:repaired,userMarkerPreserved:true,oldActivationPreserved:true}));
  await capture(ui.page,'REPAIR');
  await ui.browser.close();
})().catch(e=> {console.error(e.stack);process.exitCode=1;}).finally(()=>{clearTimeout(watchdog);stop();});
