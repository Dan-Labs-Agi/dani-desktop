// Disposable Windows runner only. Exercise the installed app, not win-unpacked.
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
// A separate process runs the exact service against the installed resources so
// public redacted UI status can be paired with the real failing integrity stage.
const diag=spawnSync(process.execPath, [path.resolve('dist-native/runtime-diagnosis.mjs'),path.join(install,'resources')], {env:process.env,encoding:'utf8',timeout:240000});
console.log(diag.stdout);console.error(diag.stderr);
assert.equal(diag.status,0,'isolated runtime diagnosis process failed');
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
async function runtime(page, retry) {
  if(retry) {
    const code=await page.evaluate(async()=> (await fetch('/api/runtime/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status);
    assert.equal(code,202,'normal renderer bootstrap request denied');
  }
  let status;
  for(let i=0;i<300;i++) {
    status=await page.evaluate(async()=> (await fetch('/api/runtime/bootstrap')).json());
    if(status.state==='ready' && status.readiness?.taskReady && status.readiness?.runtime?.hermes && status.readiness?.runtime?.opencode) {
      // Require stable readiness, then let the real renderer leave preparation.
      await sleep(3500);
      const stable=await page.evaluate(async()=> (await fetch('/api/runtime/bootstrap')).json());
      if(stable.state==='ready' && stable.readiness?.taskReady && !stable.error) return stable;
      status=stable;
    }
    if(status.state==='blocked-error' || (status.state==='repairable-error' && status.error?.code!=='not-activated')) break;
    await sleep(1000);
  }
  await capture(page,'FAILURE');
  const logfile=path.join(process.env.APPDATA,'Dani Bot/logs/server.log');
  if(fs.existsSync(logfile)) {
    const lines=fs.readFileSync(logfile,'utf8').split('\n');
    console.log('SYNTHETIC_PROFILE_SERVER_ERRORS',lines.filter(l=>/error|failed|exit|model|route/i.test(l)).map(l=>l.replace(/(token|key|secret)[:=][^\s,]+/gi,'$1=[redacted]')).slice(-35).join('\n'));
  }
  throw Error('installed runtime did not verify: '+JSON.stringify(status));
}
async function capture(page,label) {
  // Log evidence only, no Actions artifact or cache storage. Synthetic profile only.
  await page.waitForTimeout(2000);
  const png=await page.screenshot();
  const b64=png.toString('base64');
  for(let i=0;i<b64.length;i+=32000) console.log('SCREENSHOT_'+label+'_CHUNK:'+b64.slice(i,i+32000));
  console.log('SCREENSHOT_'+label+'_END');
}
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
  await capture(ui.page,'RELAUNCH');
  await ui.browser.close();stop();await sleep(3000);
  const manifest=JSON.parse(fs.readFileSync(path.join(install,'resources/managed-runtimes/manifests/hermes-win32-x64.manifest.json'),'utf8'));
  const oldNotice=path.join(data,'managed-runtimes/hermes',active.installation,manifest.noticeRelPath);
  assert.ok(fs.existsSync(oldNotice),'expected legal notice missing');
  const original=fs.readFileSync(oldNotice);
  fs.writeFileSync(oldNotice,Buffer.concat([original,Buffer.from('\nsynthetic damage')]));
  ui=await open();
  const repaired=await runtime(ui.page,true);
  const next=JSON.parse(fs.readFileSync(pointer,'utf8'));
  assert.notEqual(next.installation,active.installation,'damaged installation reused');
  assert.ok(fs.readFileSync(oldNotice).includes(Buffer.from('synthetic damage')),'old activation deleted');
  assert.equal(fs.readFileSync(marker,'utf8'),'preserve synthetic customer data');
  console.log(JSON.stringify({event:'installed-retry-verified',status:repaired,userMarkerPreserved:true,oldActivationPreserved:true}));
  await capture(ui.page,'REPAIR');
  await ui.browser.close();
})().catch(e=> {console.error(e.stack);process.exitCode=1;}).finally(()=>stop());
