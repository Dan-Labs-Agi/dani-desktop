import {afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({start:vi.fn(),stop:vi.fn()}));
vi.mock('../dani-free-runtime.ts',()=>({createDaniFreeRuntime:()=>({start:mocks.start,stop:mocks.stop,running:()=>true})}));
import {DaniFreeDriver} from './dani-free.ts';
const input={instanceId:'daniFree',displayName:'Dani Free',enabled:true,environment:{},config:{}};
afterEach(()=>{vi.restoreAllMocks();mocks.start.mockReset();mocks.stop.mockReset();});
describe('Dani Free provider',()=>{
 it('creates, describes and disposes without proxy startup or upstream discovery',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No network is allowed'));
  const instance=await DaniFreeDriver.create(input);
  expect(instance.models.default).toBe('dani-free-auto');expect(instance.displayName).toBe('Dani Free');
  await instance.snapshot();expect(mocks.start).not.toHaveBeenCalled();await instance.dispose();expect(fetcher).not.toHaveBeenCalled();
 });
 it('routes text through only the lazy local proxy, keeps the branded model, and stops on dispose',async()=>{
  mocks.start.mockResolvedValue({url:'http://127.0.0.1:45678/v1',key:'synthetic-test-key'});
  const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
    expect(String(url)).toBe('http://127.0.0.1:45678/v1/chat/completions');
    const body=JSON.parse(String(init?.body));expect(body.model).toBe('dani-free-auto');expect(body.messages[0].content).toBe('offline test');
    return new Response(JSON.stringify({choices:[{message:{content:'offline answer'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
  });
  const instance=await DaniFreeDriver.create(input);expect(await instance.generateText!('offline test')).toBe('offline answer');
  expect(fetcher).toHaveBeenCalledTimes(1);expect(mocks.start).toHaveBeenCalledTimes(1);
  await instance.dispose();expect(mocks.stop).toHaveBeenCalledTimes(1);await expect(instance.generateText!('again')).rejects.toThrow('closed');
 });
 it('shares concurrent lazy startup and does not retry a failed startup on its own',async()=>{
  mocks.start.mockRejectedValue(Error('offline startup refusal'));
  const instance=await DaniFreeDriver.create(input);
  const replies=await Promise.allSettled([instance.generateText!('a'),instance.generateText!('b')]);
  expect(replies.every(r=>r.status==='rejected')).toBe(true);expect(mocks.start).toHaveBeenCalledTimes(1);await instance.dispose();
 });
 it('returns rate limiting without retrying the model request',async()=>{
  mocks.start.mockResolvedValue({url:'http://127.0.0.1:45678/v1',key:'synthetic-test-key'});
  const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async url=>{
   expect(String(url)).toBe('http://127.0.0.1:45678/v1/chat/completions');
   return new Response(JSON.stringify({error:{message:'synthetic rate limit'}}),{status:429,headers:{'content-type':'application/json'}});
  });
  const instance=await DaniFreeDriver.create(input);
  await expect(instance.generateText!('offline rate limit test')).rejects.toThrow('429');
  expect(fetcher).toHaveBeenCalledTimes(1);expect(mocks.start).toHaveBeenCalledTimes(1);
  await instance.dispose();
 });

});
