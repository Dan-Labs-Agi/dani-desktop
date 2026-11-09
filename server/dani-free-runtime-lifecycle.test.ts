import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {join} from 'node:path';
import {afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({spawn:vi.fn(),read:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:mocks.spawn}));
vi.mock('node:fs',async original=>({...await original<typeof import('node:fs')>(),readFileSync:mocks.read}));
vi.mock('./dani-free-setup.ts',()=>({daniFreeInstalled:()=>true}));
import {createDaniFreeRuntime} from './dani-free-runtime.ts';
function fakeChild(){return Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),exitCode:null,killed:false});}
afterEach(()=>{vi.restoreAllMocks();mocks.spawn.mockReset();mocks.read.mockReset();});
describe('Dani Free subprocess lifecycle',()=>{
 it('starts once, pins routing to Kilo-only and strips inherited credentials',async()=>{
  const child=fakeChild();mocks.spawn.mockReturnValue(child);mocks.read.mockReturnValue('synthetic-local-key');
  process.env.DANI_FREE_KILO_API_KEY='should-not-inherit';process.env.DANI_FREE_KILO_BASE_URL='https://should-not-inherit.invalid';
  try {
   const runtime=createDaniFreeRuntime('/tmp/profile');const a=runtime.start(),b=runtime.start();expect(a).toBe(b);
   const options=mocks.spawn.mock.calls[0][2];expect(options.env.DANI_FREE_DISABLE_OPENCODE).toBe('1');expect(options.env.DANI_FREE_PROBE_ON_REFRESH).toBe('0');expect(options.env.DANI_FREE_KILO_API_KEY).toBeUndefined();expect(options.env.DANI_FREE_KILO_BASE_URL).toBeUndefined();
   child.stdout.write('DANI_FREE_READY '+JSON.stringify({baseUrl:'http://127.0.0.1:43210/v1',apiKeyFile:join('/tmp/profile','dani-free','api-key')})+'\n');
   expect(await a).toEqual({url:'http://127.0.0.1:43210/v1',key:'synthetic-local-key'});expect(mocks.spawn).toHaveBeenCalledTimes(1);expect(runtime.running()).toBe(true);runtime.stop();expect(child.kill).toHaveBeenCalledTimes(1);
  } finally {delete process.env.DANI_FREE_KILO_API_KEY;delete process.env.DANI_FREE_KILO_BASE_URL;}
 });
 it('cancels pending startup promptly and ignores an old process exit after restart',async()=>{
  const first=fakeChild(),second=fakeChild();mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);mocks.read.mockReturnValue('synthetic-local-key');
  const runtime=createDaniFreeRuntime('/tmp/profile');const pending=runtime.start();runtime.stop();await expect(pending).rejects.toThrow('cancelled');
  const next=runtime.start();first.emit('exit',0);expect(second.kill).not.toHaveBeenCalled();
  second.stdout.write('DANI_FREE_READY '+JSON.stringify({baseUrl:'http://127.0.0.1:43211/v1',apiKeyFile:join('/tmp/profile','dani-free','api-key')})+'\n');expect((await next).url).toBe('http://127.0.0.1:43211/v1');runtime.stop();
 });
});
