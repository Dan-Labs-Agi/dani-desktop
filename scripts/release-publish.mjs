import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const [tag,sha]=process.argv.slice(2);const repo=process.env.GITHUB_REPOSITORY;
function gh(args){return execFileSync('gh',args,{encoding:'utf8',stdio:['pipe','pipe','inherit']}).trim();}
const policy=JSON.parse(readFileSync('scripts/release-policy.json','utf8'));
if(policy.publicationApproved!==true)throw Error('Publication is awaiting the owner-approved release audience and notes. Packages remain private.');
const release=JSON.parse(gh(['release','view',tag,'--repo',repo,'--json','isDraft,targetCommitish,assets']));
if(!release.isDraft||release.targetCommitish!==sha)throw Error('Draft identity changed');
const v=tag.slice(1);const required=[`DaniBot-${v}-x86_64.AppImage`,`DaniBot-${v}-amd64.deb`,`DaniBot-${v}-setup.exe`,`DaniBot-${v}-x64.zip`,`DaniBot-${v}-arm64.dmg`,`DaniBot-${v}-arm64.zip`,`DaniBot-${v}-x64.dmg`,'DaniBot.AppImage','danibot-amd64.deb','DaniBot-setup.exe','DaniBot-Windows-Portable.zip','DaniBot-Intel.dmg','DaniBot-Intel-Portable.zip','DaniBot-Silicon.dmg','DaniBot-Silicon-Portable.zip','latest-linux.yml','latest.yml','latest-mac.yml','windows-SHA256SUMS.txt','linux-SHA256SUMS.txt','macos-SHA256SUMS.txt'];
for(const name of required)if(!release.assets.some(a=>a.name===name&&a.size>0))throw Error(`Missing required release asset ${name}`);
gh(['release','edit',tag,'--repo',repo,'--notes-file',policy.notesFile,'--draft=false',`--prerelease=${Boolean(policy.prerelease)}`,`--latest=${!policy.prerelease}`]);
console.log(gh(['release','view',tag,'--repo',repo,'--json','url,isDraft,isPrerelease,targetCommitish']));
