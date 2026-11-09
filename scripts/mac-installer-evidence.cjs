// Evidence from the mounted artifact and installed bundle, never source artwork.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
function inspectMacInstaller({installer,mount,bundle,directory,run=spawnSync,emit=console.log}) {
 fs.mkdirSync(directory,{recursive:true});
 const commands=[];
 function command(tool,args,required=true){
  const r=run(tool,args,{encoding:'utf8',timeout:60000});
  const record={tool,args,status:r.status,stdout:r.stdout||'',stderr:r.stderr||'',error:r.error?.message};
  commands.push(record);emit('DANI_MAC_INSTALLER_CHECK '+JSON.stringify(record));
  if(required && r.status!==0)throw new Error(tool+' evidence failed: '+record.stderr);
  return r;
 }
 function image(file,label){
  const b64=fs.readFileSync(file).toString('base64');
  for(let i=0;i<b64.length;i+=32000)emit('MAIN_'+label+'_SCREENSHOT_CHUNK:'+b64.slice(i,i+32000));
  emit('MAIN_'+label+'_SCREENSHOT_END');
 }
 // Record acceptance independently from signature integrity. Ad-hoc signing is
 // not Developer ID signing, and an absent ticket is not successful notarization.
 command('/usr/sbin/spctl',['--assess','--type','open','--context','context:primary-signature','--verbose=4',installer],false);
 command('/usr/sbin/spctl',['--assess','--type','execute','--verbose=4',bundle],false);
 command('/usr/bin/codesign',['-dv','--verbose=4',bundle],false);
 command('/usr/bin/xcrun',['stapler','validate',bundle],false);
 const plist=path.join(bundle,'Contents','Info.plist');
 const iconResult=command('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIconFile',plist]);
 let iconName=iconResult.stdout.trim();if(!path.extname(iconName))iconName+='.icns';
 if(path.basename(iconName)!==iconName)throw new Error('Unexpected bundle icon path');
 const actualIcon=path.join(bundle,'Contents','Resources',iconName);
 const converted=path.join(directory,'installed-icon.png');
 command('/usr/bin/sips',['-s','format','png',actualIcon,'--out',converted]);
 image(converted,'MAC_INSTALLED_ICON');
 command('/usr/bin/open',[mount]);
 command('/usr/bin/osascript',['-e','tell application "Finder" to activate','-e','delay 3']);
 const finder=path.join(directory,'mounted-dmg.png');
 command('/usr/sbin/screencapture',['-x',finder]);
 image(finder,'MAC_MOUNTED_DMG');
 // Finder may paint its labels before the bundled app icon is decoded.
 command('/usr/bin/osascript',['-e','delay 10','-e','tell application "Finder" to activate']);
 const settled=path.join(directory,'mounted-dmg-settled.png');
 command('/usr/sbin/screencapture',['-x',settled]);
 image(settled,'MAC_MOUNTED_DMG_SETTLED');
 fs.writeFileSync(path.join(directory,'security-verdicts.json'),JSON.stringify(commands,null,2));
 return commands;
}
module.exports={inspectMacInstaller};
