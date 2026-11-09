// Release assets, not Actions artifacts. Never publish or replace an existing release here.
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {releaseAssetNames} from './release-asset-names.mjs';
const [command,tag,sha,platform]=process.argv.slice(2);
const repo=process.env.GITHUB_REPOSITORY;if(!repo||!/^v\d+\.\d+\.\d+(?:-validation\.[a-f0-9]{12})?$/.test(tag??'')||!/^[a-f0-9]{40}$/.test(sha??''))throw Error('Invalid release identity');
const candidate=tag.includes('-validation.');
if(candidate&&!tag.endsWith('-validation.'+sha.slice(0,12)))throw Error('Candidate tag must identify its exact source');
function gh(args){return execFileSync('gh',args,{encoding:'utf8',stdio:['pipe','pipe','inherit']}).trim();}
if(command==='check-version') {
 const releases=JSON.parse(gh(['api',`repos/${repo}/releases?per_page=100`]));
 if(releases.some(r=>r.tag_name===tag&&!r.draft))throw Error('This version is already published. Bump package.json before merging.');
 console.log('Release version is not published.');
} else if(command==='prepare') {
 const releases=JSON.parse(gh(['api',`repos/${repo}/releases?per_page=100`]));
 const old=releases.find(r=>r.tag_name===tag);
 if(old){if(!old.draft||old.target_commitish!==sha)throw Error('Release already exists for another source or is published');console.log(old.id);}
 else {
  const response=gh(['api','--method','POST',`repos/${repo}/releases`,'-f',`tag_name=${tag}`,'-f',`target_commitish=${sha}`,'-f',`name=Dani Bot ${tag.slice(1)}${candidate?' private validation':''}`,'-F','draft=true','-F',`prerelease=${candidate}`,'-f','body=Installer validation is still running.']);
  console.log(JSON.parse(response).id);
 }
} else if(command==='upload') {
 const release=JSON.parse(gh(['release','view',tag,'--repo',repo,'--json','isDraft,targetCommitish']));
 if(!release.isDraft||release.targetCommitish!==sha)throw Error('Draft source changed');
 const files=releaseAssetNames(readdirSync('release'),platform);
 if(!files.length)throw Error('No release files');
 const inventory=files.map(name=>({name,sha256:createHash('sha256').update(readFileSync(join('release',name))).digest('hex')}));
 const manifest=`${platform}-SHA256SUMS.txt`;writeFileSync(join('release',manifest),inventory.map(x=>`${x.sha256}  ${x.name}\n`).join(''));
 for(const name of [...files,manifest])gh(['release','upload',tag,join('release',name),'--repo',repo]);
 console.log(JSON.stringify({sha,platform,inventory}));
} else throw Error('Unknown operation');
