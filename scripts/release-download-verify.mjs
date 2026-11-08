// Exact staged-release bytes are downloaded by a fresh native runner, then installed and exercised.
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [tag,sha,platform]=process.argv.slice(2);const repo=process.env.GITHUB_REPOSITORY;
function gh(args){return execFileSync('gh',args,{encoding:'utf8',stdio:['pipe','pipe','inherit']}).trim();}
const draft=JSON.parse(gh(['release','view',tag,'--repo',repo,'--json','isDraft,targetCommitish']));if(!draft.isDraft||draft.targetCommitish!==sha)throw Error('Draft identity changed');
mkdirSync('release',{recursive:true});
const patterns=platform==='windows' ? ['*-setup.exe','windows-SHA256SUMS.txt'] : platform==='linux' ? ['*-amd64.deb','linux-SHA256SUMS.txt'] : [`*-${process.arch==='arm64'?'arm64':'x64'}.dmg`,'macos-SHA256SUMS.txt'];
for(const pattern of patterns)gh(['release','download',tag,'--repo',repo,'--pattern',pattern,'--dir','release']);
const sums=readFileSync(`release/${platform}-SHA256SUMS.txt`,'utf8').trim().split(/\r?\n/).map(line=>line.split('  '));
for(const name of readdirSync('release').filter(n=>!n.endsWith('.txt'))){const expected=sums.find(([,file])=>file===name)?.[0];const actual=createHash('sha256').update(readFileSync(`release/${name}`)).digest('hex');if(!expected||actual!==expected)throw Error(`Downloaded hash mismatch: ${name}`);console.log(JSON.stringify({sha,platform,name,sha256:actual}));}
