// Fetch the actual published migration source, never a synthetic substitute.
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const metadata=await fetch('https://api.github.com/repos/Dan-Labs-Agi/dani-desktop/releases/tags/v0.1.58');
if(!metadata.ok)throw Error(`published metadata HTTP ${metadata.status}`);
const release=await metadata.json();
if(release.tag_name!=='v0.1.58'||release.draft)throw Error('published migration source is not v0.1.58');
const asset=release.assets.filter(a=>a.name==='DaniBot-0.1.58-amd64.deb');
if(asset.length!==1||asset[0].id!==702141437||asset[0].size!==450485508)throw Error('published migration source identity changed');
const response=await fetch('https://api.github.com/repos/Dan-Labs-Agi/dani-desktop/releases/assets/702141437',{headers:{Accept:'application/octet-stream'},signal:AbortSignal.timeout(180000)});
if(!response.ok)throw Error(`published DEB HTTP ${response.status}`);
const bytes=Buffer.from(await response.arrayBuffer());
const hash=createHash('sha256').update(bytes).digest('hex');
if(bytes.length!==450485508||hash!=='d61e9d434efef9034587be8db32ff1d7667dd7ac875c5773f5f40951fddd540b')throw Error('published migration source integrity failed');
const file=join(process.env.RUNNER_TEMP,'published-DaniBot-0.1.58-amd64.deb');writeFileSync(file,bytes);
console.log(JSON.stringify({event:'published-migration-source',url:release.html_url,bytes:bytes.length,sha256:hash,file}));
