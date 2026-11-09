import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {installerDownloads,verifyInstallerDownloads} from './installer-download-contract.mjs';
const bytes=Buffer.from('exact installer fixture');const digest=createHash('sha256').update(bytes).digest('hex');
test('every README installer format has an exact version and stable alias',()=>{
 for(const [platform,format,arch,alias] of [['windows','nsis','x64','DaniBot-setup.exe'],['windows','zip','x64','DaniBot-Windows-Portable.zip'],['macos','dmg','arm64','DaniBot-Silicon.dmg'],['macos','dmg','x64','DaniBot-Intel.dmg'],['linux','deb','x64','danibot-amd64.deb'],['linux','appimage','x64','DaniBot.AppImage']]){
  const target=installerDownloads('0.1.139',platform,format,arch);assert.equal(target.alias,alias);assert.ok(target.versioned.includes('0.1.139'));assert.equal(target.manifest,platform+'-SHA256SUMS.txt');
  const sums=[target.versioned,target.alias].map(n=>digest+'  '+n).join('\n');assert.equal(verifyInstallerDownloads(target,sums,()=>bytes).length,2);
 }
});
test('rejects corrupt, missing, zero length and different alias bytes',()=>{
 const t=installerDownloads('0.1.139','windows','zip');const sums=[t.versioned,t.alias].map(n=>digest+'  '+n).join('\n');
 assert.throws(()=>verifyInstallerDownloads(t,sums,()=>Buffer.from('corrupt')),/hash mismatch/);
 assert.throws(()=>verifyInstallerDownloads(t,digest+'  '+t.versioned,()=>bytes),/hash mismatch/);
 assert.throws(()=>verifyInstallerDownloads(t,sums,()=>Buffer.alloc(0)),/hash mismatch/);
 const other=Buffer.from('wrong older installer'),otherHash=createHash('sha256').update(other).digest('hex');
 assert.throws(()=>verifyInstallerDownloads(t,digest+'  '+t.versioned+'\n'+otherHash+'  '+t.alias,n=>n===t.alias?other:bytes),/Stable alias/);
});
test('rejects invalid identity and malformed or duplicate manifests',()=>{
 assert.throws(()=>installerDownloads('../latest','linux','deb'),/Invalid release/);assert.throws(()=>installerDownloads('0.1.139','linux','zip'),/Unsupported/);
 const t=installerDownloads('0.1.139','linux','deb');assert.throws(()=>verifyInstallerDownloads(t,digest+'  ../evil',()=>bytes),/Invalid checksum/);assert.throws(()=>verifyInstallerDownloads(t,[digest+'  '+t.alias,digest+'  '+t.alias].join('\n'),()=>bytes),/Duplicate/);
});
