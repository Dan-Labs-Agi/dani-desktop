// Disposable native runner verification. Downloads + offline --version/--help only, never starts a model service.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installStandaloneEngine, standalonePlatformKey } from '../server/engine-standalone.ts';
import { DANI_FREE_TOOLS, daniFreeInstalled } from '../server/dani-free-setup.ts';
const baseDir=mkdtempSync(join(tmpdir(),'dani-free-native-'));
try {
 for (const pass of ['install','reuse']) {
  for(const release of DANI_FREE_TOOLS){const at=Date.now();const result=await installStandaloneEngine(release,{baseDir});console.log(JSON.stringify({pass,platform:standalonePlatformKey(),tool:release.engine,version:result.version,ms:Date.now()-at}));}
  if(!daniFreeInstalled(baseDir))throw new Error('Verified install set is incomplete.');
 }
 console.log('DANI_FREE_NATIVE_INSTALL_REUSE_PASS');
} finally {rmSync(baseDir,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
