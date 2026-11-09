const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {inspectMacInstaller}=require('./mac-installer-evidence.cjs');
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dani-mac-evidence-'));
 const options={installer:'/artifact/DaniBot-arm64.dmg',mount:'/mounted-artifact',bundle:'/installed/Dani Bot.app',directory,emit:()=>{},run:(tool,args)=>{
  if(tool.endsWith('PlistBuddy'))return {status:0,stdout:'installed-icon.icns\n'};
  if(tool.endsWith('sips'))fs.writeFileSync(args.at(-1),Buffer.from('synthetic-icon-test-bytes'));
  if(tool.endsWith('screencapture'))fs.writeFileSync(args.at(-1),Buffer.from('synthetic-finder-test-bytes'));
  return {status:0,stdout:''};
 }};
 return {options,cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
test('fails visual evidence capture rather than treating a missing screenshot as success',()=>{
 const f=fixture(),run=f.options.run;try{
  f.options.run=(tool,args)=>tool.endsWith('screencapture')?{status:1,stderr:'capture unavailable'}:run(tool,args);
  assert.throws(()=>inspectMacInstaller(f.options));
 }finally{f.cleanup();}
});
