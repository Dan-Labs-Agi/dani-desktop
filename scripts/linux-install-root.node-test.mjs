import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import beforePack from './before-pack.mjs';
const require=createRequire(import.meta.url);
const builderRequire=createRequire(require.resolve('electron-builder'));
const {LinuxTargetHelper}=builderRequire('app-builder-lib/out/targets/LinuxTargetHelper.js');
test('actual builder desktop entry changes only Linux install root, not display/data identity',async()=>{
 const appInfo={productName:'Dani Bot',sanitizedProductName:'Dani Bot',productFilename:'danibot',id:'com.danibot.app',description:'Fixture'};
 const packager={config:{},fileAssociations:[],appInfo,executableName:'danibot',info:{metadata:{name:'danibot',desktopName:'danibot'}},platformSpecificBuildOptions:{},expandMacro:x=>x};
 await beforePack({electronPlatformName:'linux',packager});
 assert.deepEqual(appInfo,{productName:'Dani Bot',sanitizedProductName:'danibot',productFilename:'danibot',id:'com.danibot.app',description:'Fixture'});
 const entry=await LinuxTargetHelper.prototype.computeDesktopEntry.call({packager,getDescription:()=>appInfo.description},{desktop:{entry:{Name:'Dani Bot'}},category:'Utility'});
 assert.match(entry,/Exec=\/opt\/danibot\/danibot %U/);
 assert.match(entry,/Name=Dani Bot/);
 assert.doesNotMatch(entry,/--no-sandbox|--disable-gpu-sandbox/);
 await beforePack({electronPlatformName:'darwin',packager:{appInfo:{productName:'different'}}});
});
test('package payload and custom privileged hooks pin the same space-free root',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 assert.match(read('electron-builder.yml'),/^productName: Dani Bot$/m);
 assert.match(read('electron-builder.yml'),/^appId: com.danibot.app$/m);
 assert.match(read('electron-builder.yml'),/beforePack: .\/scripts\/before-pack.mjs/);
 assert.match(read('build/linux-after-install.sh'),/APP_ROOT="\/opt\/danibot"/);
 assert.match(read('build/linux-danibot-browser.apparmor'),/\/opt\/danibot\/\{danibot,/);
 assert.match(read('build/linux-after-remove.sh'),/"\/opt\/danibot\/danibot" "\/opt\/Dani Bot\/danibot"/);
});
test('published migration is exact real source and required before publication',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const source=read('scripts/fetch-published-deb-migration.mjs');
 assert.match(source,/702141437/);assert.match(source,/450485508/);assert.match(source,/d61e9d434efef9034587be8db32ff1d7667dd7ac875c5773f5f40951fddd540b/);
 const migration=read('scripts/verify-deb-published-migration.cjs');
 for(const value of ['published-state.json','assertPreserved(JSON.parse(JSON.stringify(state))','/api/threads/','synthetic-preserved-marker.txt','PUBLISHED_DEB_MIGRATION_'])assert.ok(migration.includes(value));
 const shell=read('scripts/verify-deb-published-migration.sh');
 assert.match(shell,/DANI_MIGRATION_PHASE=published/);assert.match(shell,/DANI_MIGRATION_PHASE=upgraded/);
 assert.doesNotMatch(shell,/--no-sandbox|--disable-gpu-sandbox|chown[^\n]*\/opt/);
 assert.match(read('.github/workflows/release.yml'),/needs: \[prepare, linux, windows, macos, download_check, checks, published_deb_migration\]/);
});

test('DEB extraction and migration desktop assertions follow the real builder paths',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const verifier=read('scripts/verify-linux-package.mjs');
 assert.ok(verifier.includes('path.join(extracted, "opt", "danibot")'));
 assert.ok(verifier.includes("'Exec=/opt/danibot/danibot %U'"));
 assert.ok(!verifier.includes('path.join(extracted, "opt", "Dani Bot")'));
 assert.ok(read('scripts/verify-deb-published-migration.cjs').includes('/usr/share/applications/com.danibot.app.desktop'));
});

test('private DEB cleanup waits only for its own verifier and never ignores a busy mount',()=>{
 for(const name of ['scripts/verify-deb-clean-opt.sh','scripts/verify-deb-published-migration.sh']){
  const s=readFileSync(new URL('../'+name,import.meta.url),'utf8');
  assert.match(s,/for attempt in \$\(seq 1 20\)/);
  assert.match(s,/DANI_PRIVATE_OPT_UNMOUNT_PASS/);
  assert.match(s,/exit 32/);
  assert.doesNotMatch(s,/umount -[fl]|pkill|killall/);
 }
 const migration=readFileSync(new URL('./verify-deb-published-migration.sh',import.meta.url),'utf8');
 assert.ok(migration.includes("-name 'DaniBot-*-amd64.deb'"));
});

test('old published GUI compatibility check is bounded to a supported OS, not a sandbox override',()=>{
 const s=readFileSync(new URL('./verify-deb-published-migration.sh',import.meta.url),'utf8');
 assert.doesNotMatch(s,/sysctl[^\n]*=|--no-sandbox|--disable-gpu-sandbox/);
 for(const name of ['permanent-installer-validation','tested-preview-download','release']){
  const source=readFileSync(new URL('../.github/workflows/'+name+'.yml',import.meta.url),'utf8').split('  published_deb_migration:')[1];
  assert.match(source,/runs-on: ubuntu-22.04/);
 }
 assert.ok(readFileSync(new URL('./smoke-deb-upgrade.mjs',import.meta.url),'utf8').includes('/usr/share/applications/com.danibot.app.desktop'));
});

test('migration comparison preserves all old fields and message contents while allowing new schema fields',()=>{
 const source=readFileSync(new URL('./verify-deb-published-migration.cjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function assertPreserved('),source.indexOf('function stop(){'));
 const compare=new Function('assert',body+';return assertPreserved;')(assert);
 const old={profile:{name:''},messages:[{id:'1',role:'bot',content:'real saved text'}]};
 compare({profile:{name:'',aboutMe:''},messages:[{id:'1',role:'bot',content:'real saved text',extra:true}]},old);
 assert.throws(()=>compare({profile:{name:''},messages:[{id:'1',role:'bot',content:'lost text'}]},old));
 assert.throws(()=>compare({profile:{name:''},messages:[]},old));
 assert.throws(()=>compare({profile:{},messages:old.messages},old));
 assert.ok(source.includes('messages:body.messages??body'));
});
