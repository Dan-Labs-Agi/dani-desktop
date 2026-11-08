// Upload only after local native checks, then fetch exact draft bytes for a
// second native pass. Never publish a release or replace an existing asset.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const repo=process.env.GITHUB_REPOSITORY;
const sha=process.env.GITHUB_SHA;
const tag='v0.1.59-intel-repair.1';
if(repo!=='Dan-Labs-Agi/dani-desktop'||!/^([0-9a-f]{40})$/.test(sha||''))throw Error('Unexpected repository/source');
function api(args){return execFileSync('gh',args,{encoding:'utf8',maxBuffer:8*1024*1024});}
const releases=JSON.parse(api(['api',`repos/${repo}/releases?per_page=100`]));
if(releases.some(r=>r.tag_name===tag))throw Error('Test draft already exists; no overwrite allowed');
const file=fs.readdirSync('release').filter(f=>f.endsWith('-x64.dmg'));
if(file.length!==1)throw Error('Expected exactly one Intel DMG');
const artifact=path.resolve('release',file[0]);
const bytes=fs.readFileSync(artifact),hash=crypto.createHash('sha256').update(bytes).digest('hex');
const body=`Private Intel startup-repair test only. Source ${sha}. SHA256 ${hash}. Older Hermes/OpenCode architecture, not the new Dani Free update. Unsigned/ad-hoc signed: Gatekeeper may refuse opening. Native installation/activation/relaunch/recovery checked on built bytes; exact downloaded bytes verification still pending. Public publication not approved.`;
api(['release','create',tag,'--repo',repo,'--draft','--prerelease','--target',sha,'--title','Dani Intel startup repair - private test','--notes',body]);
api(['release','upload',tag,artifact,'--repo',repo]);
const downloaded=path.resolve('downloaded-release');fs.mkdirSync(downloaded,{recursive:true});
api(['release','download',tag,'--repo',repo,'--pattern',file[0],'--dir',downloaded]);
const returned=fs.readFileSync(path.join(downloaded,file[0]));
if(!bytes.equals(returned))throw Error('Downloaded draft bytes differ');
console.log(JSON.stringify({event:'exact-download',sha256:hash,bytes:bytes.length,source:sha}));
const original=path.resolve('built-release');fs.renameSync('release',original);fs.renameSync(downloaded,'release');
console.log(api(['release','view',tag,'--repo',repo,'--json','url,isDraft,targetCommitish,assets']));
