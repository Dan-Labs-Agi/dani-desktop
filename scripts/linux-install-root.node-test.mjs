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
