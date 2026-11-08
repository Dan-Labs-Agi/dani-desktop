// The router is lazy: installing tools and reading a provider snapshot never starts it.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';
import { cliProbeEnvironment } from './cli-probe.ts';
import { daniFreeInstalled } from './dani-free-setup.ts';
import { standaloneAssetFor } from './engine-standalone.ts';
import { DANI_FREE_PROXY } from './dani-free-releases.ts';
export type DaniFreeConnection = { url: string; key: string };
export function parseDaniFreeReady(line: string, home: string): { url: string; keyPath: string } | null {
  if (!line.startsWith('DANI_FREE_READY ')) return null;
  try {
    const ready = JSON.parse(line.slice('DANI_FREE_READY '.length));
    const url = new URL(ready.baseUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/v1' || url.username || url.password || url.search || url.hash || ready.apiKeyFile !== join(home,'api-key')) return null;
    return {url: url.href, keyPath: ready.apiKeyFile};
  } catch { return null; }
}
export function createDaniFreeRuntime(baseDir = DATA_DIR) {
  let child: ChildProcess | undefined;
  let pending: Promise<DaniFreeConnection> | undefined;
  let connection: DaniFreeConnection | undefined;
  const home = join(baseDir,'dani-free');
  const stop = () => { child?.kill(); child = undefined; connection = undefined; pending = undefined; };
  const start = (): Promise<DaniFreeConnection> => {
    if (connection) return Promise.resolve(connection);
    if (pending) return pending;
    if (!daniFreeInstalled(baseDir)) return Promise.reject(new Error('Install Dani Free before starting a conversation.'));
    const executable = join(baseDir,'tools','standalone',DANI_FREE_PROXY.engine,DANI_FREE_PROXY.version,standaloneAssetFor(DANI_FREE_PROXY)!.executable);
    pending = new Promise<DaniFreeConnection>((resolve,reject) => {
      let settled = false, buffer = '';
      const finish = (error?: Error, result?: DaniFreeConnection) => { if(settled)return; settled=true;clearTimeout(timer);if(error){stop();reject(error);}else{connection=result;resolve(result!);} };
      const timer = setTimeout(() => finish(new Error('Dani Free did not start in time.')),30_000);
      const inherited=cliProbeEnvironment();
      // Do not inherit backend credentials, custom routing, or agent control-plane tokens.
      const env: NodeJS.ProcessEnv = {};
      for (const name of ['PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','LANG','LC_ALL']) if(inherited[name]!==undefined)env[name]=inherited[name];
      const launched=child=spawn(executable,['start','--host','127.0.0.1','--port','0'],{env:{...env,DANI_FREE_HOME:home,DANI_FREE_DISABLE_OPENCODE:'1',DANI_FREE_PROBE_ON_REFRESH:'0',DANI_FREE_ENGINE_AUTOUPDATE:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
      child.on('error',()=>finish(new Error('Dani Free could not start. Try setup again.')));
      child.on('exit',()=>{const wasSettled=settled;finish(new Error('Dani Free stopped before it was ready.')); if(wasSettled && child===launched)stop();});
      child.stderr?.resume();
      child.stdout?.on('data',(chunk: Buffer)=>{
        buffer+=chunk.toString();if(buffer.length>64*1024)return finish(new Error('Dani Free returned an invalid startup response.'));
        const lines=buffer.split(/\r?\n/);buffer=lines.pop()!;
        for(const line of lines){const ready=parseDaniFreeReady(line,home);if(!ready)continue;try { const key=readFileSync(ready.keyPath,'utf8').trim();if(!key || key.length>4096)throw Error();finish(undefined,{url:ready.url,key}); }catch{finish(new Error('Dani Free could not read its local connection key.'));}}
      });
    }).finally(()=>{pending=undefined;});
    return pending;
  };
  return {start,stop,running:()=>Boolean(connection && child && child.exitCode===null && !child.killed)};
}
