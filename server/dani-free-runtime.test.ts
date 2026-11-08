import {describe,it,expect} from 'vitest';
import {join} from 'node:path';
import {parseDaniFreeReady,createDaniFreeRuntime} from './dani-free-runtime.ts';
describe('Dani Free local runtime boundary',()=>{
 const home='/tmp/test-home';
 const line=(url:string,keyPath=join(home,'api-key'))=>'DANI_FREE_READY '+JSON.stringify({baseUrl:url,apiKeyFile:keyPath});
 it('accepts only loopback connection with its own per-install key path',()=>{
  expect(parseDaniFreeReady(line('http://127.0.0.1:45678/v1'),home)).toEqual({url:'http://127.0.0.1:45678/v1',keyPath:join(home,'api-key')});
 });
 it.each(['https://untrusted.test/v1','http://localhost:22/v1','http://127.0.0.1:1234/wrong','http://user:pass@127.0.0.1/v1','http://127.0.0.1/v1?x=1'])('refuses an unexpected endpoint %s',url=>{expect(parseDaniFreeReady(line(url),home)).toBe(null);});
 it('refuses another file or malformed output',()=>{expect(parseDaniFreeReady(line('http://127.0.0.1:123/v1','/other/key'),home)).toBe(null);expect(parseDaniFreeReady('DANI_FREE_READY broken',home)).toBe(null);});
 it('does not start without verified tools',async()=>{const runtime=createDaniFreeRuntime('/not-an-install');await expect(runtime.start()).rejects.toThrow('Install Dani Free');runtime.stop();});
});
