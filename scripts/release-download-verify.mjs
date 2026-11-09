// Download both advertised stable aliases and their versioned exact bytes before native execution.
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync} from 'node:fs';
import {installerDownloads,verifyInstallerDownloads} from './installer-download-contract.mjs';
const [tag,sha,platform,format=platform==='windows'?'nsis':platform==='linux'?'deb':'dmg']=process.argv.slice(2);
const repo=process.env.GITHUB_REPOSITORY;
function gh(args){return execFileSync('gh',args,{encoding:'utf8',stdio:['pipe','pipe','inherit']}).trim();}
const draft=JSON.parse(gh(['release','view',tag,'--repo',repo,'--json','isDraft,targetCommitish']));
if(!draft.isDraft||draft.targetCommitish!==sha)throw Error('Draft identity changed');
const target=installerDownloads(tag.slice(1),platform,format,process.arch);
mkdirSync('release',{recursive:true});
for(const name of [target.versioned,target.alias,target.manifest])gh(['release','download',tag,'--repo',repo,'--pattern',name,'--dir','release']);
for(const record of verifyInstallerDownloads(target,readFileSync(`release/${target.manifest}`,'utf8'),name=>readFileSync(`release/${name}`)))console.log(JSON.stringify({sha,platform,format,...record}));
