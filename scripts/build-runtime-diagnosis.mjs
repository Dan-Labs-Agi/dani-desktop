// Keep instrumentation out of packaged product. Only the isolated diagnostic bundle
// prints integrity stage and changed relative file names on a disposable CI profile.
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const snapshot = `async function diagnosticSnapshot(root) {
 const result = {}; const visit = async directory => { for(const name of await readdir(directory)) {
 const path=join(directory,name), rel=relative(root,path), info=await lstat(path);
 if(info.isDirectory()) await visit(path); else if(info.isFile()) result[rel]={size:info.size,hash:await digestFile(path)};
 }}; await visit(root); return result;
}\n`;
await build({entryPoints:['scripts/diagnose-installed-runtime.ts'],bundle:true,platform:'node',format:'esm',outfile:'dist-native/runtime-diagnosis.mjs',banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'},plugins:[{name:'diagnostic-only',setup(build) {
 build.onLoad({filter:/[\\/]server[\\/]managed-runtime\.ts$/}, args=> {
 let contents=readFileSync(args.path,'utf8');
 contents=contents.replace('async function extractArchive(',snapshot+'async function extractArchive(');
 contents=contents.replace('throw new Error("exact free model route is not ready");', 'throw new Error("exact free model route is not ready: "+JSON.stringify({status:response.status,body}));');
 contents=contents.replace('catch { await new Promise(resolveWait => setTimeout(resolveWait, 250)); }', 'catch (error) { console.error("DIAGNOSTIC_ROUTE_REASON",String(error)); await new Promise(resolveWait => setTimeout(resolveWait, 250)); }');
 contents=contents.replace('new Error("runtime unpacked size mismatch")','new Error(`runtime unpacked size mismatch actual=${unpacked} expected=${entry.unpackedSize}`)');
 contents=contents.replaceAll('} catch (error) {', '} catch (error) { console.error("DIAGNOSTIC_SERVICE_ERROR",error);');
 contents=contents.replace('await waitForReady(`${bridgeUrl}/ready`, 30_000);', `this.opencodeServer.stderr?.on('data',d=>console.error('DIAGNOSTIC_OPENCODE',d.toString()));
 this.bridge.stderr?.on('data',d=>console.error('DIAGNOSTIC_BRIDGE',d.toString()));
 await waitForReady(\`\${bridgeUrl}/ready\`, 30_000);`);
 contents=contents.replace('await this.probe(kind, stagedExecutable, entry, staging);',`const beforeProbe=await diagnosticSnapshot(staging);
 await this.probe(kind, stagedExecutable, entry, staging);
 const afterProbe=await diagnosticSnapshot(staging);
 console.log('DIAGNOSTIC_PROBE_DIFF',JSON.stringify(Object.keys({...beforeProbe,...afterProbe}).filter(k=>JSON.stringify(beforeProbe[k])!==JSON.stringify(afterProbe[k])).map(k=>({file:k,before:beforeProbe[k],after:afterProbe[k]}))));`);
 return {contents,loader:'ts'};
 });
}}]});
