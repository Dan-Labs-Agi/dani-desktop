const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ownedProfileFiles} = require('./owned-profile-files.cjs');
test('enumerates explicit owned files without entering HOME, tools or linked logs', () => {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'owned-profile-'));
 try {
  fs.mkdirSync(path.join(temp,'profile/tools/unrelated'),{recursive:true});
  fs.mkdirSync(path.join(temp,'home/private'),{recursive:true});
  fs.mkdirSync(path.join(temp,'electron-user-data/logs'),{recursive:true});
  fs.writeFileSync(path.join(temp,'profile/config.json'),'{}');
  fs.writeFileSync(path.join(temp,'home/private/server.log'),'private');
  fs.writeFileSync(path.join(temp,'profile/tools/unrelated/config.json'),'unrelated');
  fs.writeFileSync(path.join(temp,'electron-user-data/logs/server.log'),'owned');
  assert.deepEqual(ownedProfileFiles(temp).sort(),['profile/config.json','electron-user-data/logs/server.log'].map(x=>path.normalize(x)).sort());
  if(process.platform!=='win32'){
   fs.symlinkSync(path.join(temp,'home/private'),path.join(temp,'profile/logs'),'dir');
   assert.equal(ownedProfileFiles(temp).length,2);
  }
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
test('DEB environment is private, preflighted and nonroot without mutating host ownership',()=>{
 const source=fs.readFileSync(path.join(__dirname,'verify-deb-clean-opt.sh'),'utf8');
 assert.ok(source.includes('sudo -n unshare --mount --propagation private -- true'));
 assert.ok(source.includes('mount -t tmpfs -o mode=0755,uid=0,gid=0 tmpfs /opt'));
 assert.ok(source.includes('runuser -u "$runner" -- "$node_copy" "$verifier"'));
 assert.ok(source.includes("trap 'umount /opt' EXIT"));
 assert.doesNotMatch(source,/chown|chmod[^\n]*\/opt|--no-sandbox|--disable-gpu-sandbox/);
});
