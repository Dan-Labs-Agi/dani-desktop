import {createHash} from 'node:crypto';
export function installerDownloads(version,platform,format,arch='x64') {
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid release version');
 const targets={
  'windows:nsis':[`DaniBot-${version}-setup.exe`,'DaniBot-setup.exe'],
  'windows:zip':[`DaniBot-${version}-x64.zip`,'DaniBot-Windows-Portable.zip'],
  'macos:dmg':[`DaniBot-${version}-${arch==='arm64'?'arm64':'x64'}.dmg`,arch==='arm64'?'DaniBot-Silicon.dmg':'DaniBot-Intel.dmg'],
  'linux:deb':[`DaniBot-${version}-amd64.deb`,'danibot-amd64.deb'],
  'linux:appimage':[`DaniBot-${version}-x86_64.AppImage`,'DaniBot.AppImage'],
 };
 const pair=targets[`${platform}:${format}`];if(!pair)throw Error('Unsupported installer target');return {versioned:pair[0],alias:pair[1],manifest:`${platform}-SHA256SUMS.txt`};
}
export function verifyInstallerDownloads(target,manifest,read) {
 const entries=new Map();
 for(const line of manifest.trim().split(/\r?\n/)){
  const match=/^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);if(!match)throw Error('Invalid checksum manifest line');
  if(entries.has(match[2]))throw Error('Duplicate checksum manifest entry');entries.set(match[2],match[1]);
 }
 const records=[target.versioned,target.alias].map(name=>{
  const bytes=read(name),hash=createHash('sha256').update(bytes).digest('hex');
  if(!bytes.length||!entries.has(name)||entries.get(name)!==hash)throw Error('Downloaded hash mismatch: '+name);
  return {name,sha256:hash,bytes:bytes.length};
 });
 if(records[0].sha256!==records[1].sha256||records[0].bytes!==records[1].bytes)throw Error('Stable alias does not match versioned installer');return records;
}
