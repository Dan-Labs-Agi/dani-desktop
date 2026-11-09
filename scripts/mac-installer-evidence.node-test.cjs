const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {inspectMacInstaller}=require('./mac-installer-evidence.cjs');
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dani-mac-evidence-'));
 const calls=[],lines=[];
 const options={installer:'/artifact/DaniBot-arm64.dmg',mount:'/mounted-artifact',bundle:'/installed/Dani Bot.app',directory,emit:l=>lines.push(l),run:(tool,args)=>{
  calls.push({tool,args});
  if(tool.endsWith('PlistBuddy'))return {status:0,stdout:'installed-icon.icns\n'};
  if(tool.endsWith('sips'))fs.writeFileSync(args.at(-1),Buffer.from('synthetic-icon-test-bytes'));
  if(tool.endsWith('screencapture'))fs.writeFileSync(args.at(-1),Buffer.from('synthetic-finder-test-bytes'));
  if(tool.endsWith('spctl')||tool.endsWith('xcrun'))return {status:1,stderr:'not accepted'};
  return {status:0,stdout:''};
 }};
 return {options,calls,lines,cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
test('keeps failed acceptance/ticket verdicts distinct and captures actual artifact surfaces',()=>{
 const f=fixture();try{
  const records=inspectMacInstaller(f.options);
  assert.equal(records.filter(r=>r.status===1).length,3);
  assert.ok(f.lines.some(l=>l.includes('"status":1')));
  assert.ok(f.calls.some(c=>c.tool.endsWith('sips')&&c.args.includes('/installed/Dani Bot.app/Contents/Resources/installed-icon.icns')));
  assert.ok(f.calls.some(c=>c.tool.endsWith('/open')&&c.args[0]==='/mounted-artifact'));
  assert.ok(f.lines.includes('MAIN_MAC_INSTALLED_ICON_SCREENSHOT_END'));
  assert.ok(f.lines.includes('MAIN_MAC_MOUNTED_DMG_SCREENSHOT_END'));
  assert.ok(!f.calls.some(c=>/xattr|sudo/.test(c.tool)));
 }finally{f.cleanup();}
});
test('fails visual evidence capture rather than treating a missing screenshot as success',()=>{
 const f=fixture(),run=f.options.run;try{
  f.options.run=(tool,args)=>tool.endsWith('screencapture')?{status:1,stderr:'capture unavailable'}:run(tool,args);
  assert.throws(()=>inspectMacInstaller(f.options),/evidence failed/);
  assert.ok(!f.lines.includes('MAIN_MAC_MOUNTED_DMG_SCREENSHOT_END'));
 }finally{f.cleanup();}
});
