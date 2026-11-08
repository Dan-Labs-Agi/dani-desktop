import type { ProviderDriver, ProviderInstance } from '../contracts.ts';
import { createOpenAIChatRuntime } from './openai-chat.ts';
import { createDaniFreeRuntime } from '../dani-free-runtime.ts';
import { daniFreeInstalled } from '../dani-free-setup.ts';
const models = { default: 'dani-free-auto', options: [{id:'dani-free-auto',label:'Dani Free Auto'}] };
export const DaniFreeDriver: ProviderDriver<Record<string, never>> = {
  driverKind:'dani-free', metadata:{displayName:'Dani Free',access:'custom'}, models,
  decodeConfig:()=>({}),defaultConfig:()=>({}),
  async create(input) {
    const router=createDaniFreeRuntime();
    let runtime: ProviderInstance | undefined;
    let loading: Promise<ProviderInstance> | undefined;
    let disposed=false;
    const listeners = new Set<Parameters<ProviderInstance['adapter']['onEvent']>[0]>();
    const ensure=():Promise<ProviderInstance> => {
      if(disposed)return Promise.reject(new Error('Dani Free connection is closed.'));
      if(runtime && router.running())return Promise.resolve(runtime);
      if(loading)return loading;
      loading=router.start().then(async ({url,key})=>{
        await runtime?.dispose();
        if(disposed)throw new Error('Dani Free connection is closed.');
        runtime=createOpenAIChatRuntime({input,driverKind:'dani-free',apiKey:key,apiUrl:url,models:()=>models,
          requestBody:(model,messages,stream)=>({model,messages,stream}),httpErrorLabel:'Dani Free',missingKeyError:'Dani Free local connection is not ready.',unavailableReason:'Install Dani Free.',timeoutMs:180_000,
          tools:true,computerUse:true,reasoning:true,nativeLog:{source:'dani-free.chat.completions',outgoing:(_turn,messages,model,tools)=>({model,messageCount:messages.length,toolCount:tools.length}),incoming:({text})=>({textLength:text.length})}});
        for(const listener of listeners)runtime.adapter.onEvent(listener);
        return runtime;
      }).finally(()=>{loading=undefined;});
      return loading;
    };
    // A dormant instance describes capabilities without starting the proxy or doing any network discovery.
    const dormant=createOpenAIChatRuntime({input,driverKind:'dani-free',apiKey:'',apiUrl:'http://127.0.0.1:1/v1',models:()=>models,requestBody:()=>({}),httpErrorLabel:'Dani Free',missingKeyError:'Install Dani Free.',unavailableReason:'Install Dani Free.',timeoutMs:180_000,tools:true,computerUse:true,nativeLog:{source:'dani-free',outgoing:()=>({}),incoming:()=>({})}});
    return {...dormant,
      displayName: input.displayName ?? 'Dani Free',
      snapshot:async()=>daniFreeInstalled() ? {state:'available',authenticated:true,version:null,reason:'Tools installed. Live model connection has not been verified.'} : {state:'unavailable',reason:'Install Dani Free.'},
      adapter:{...dormant.adapter,
        sendTurn:async turn=>(await ensure()).adapter.sendTurn(turn),
        interruptTurn:async(...args)=>{await runtime?.adapter.interruptTurn(...args);},
        respondToRequest:async(...args)=>runtime ? runtime.adapter.respondToRequest(...args) : 'unavailable',
        steer:async(...args)=>runtime ? runtime.adapter.steer!(...args) : 'refused',
        hasSession:threadId=>runtime?.adapter.hasSession?.(threadId) ?? false,
        stopAll:async()=>{await runtime?.adapter.stopAll();},
        onEvent:listener=>{listeners.add(listener);const off=runtime?.adapter.onEvent(listener);return()=>{listeners.delete(listener);off?.();};},
      },
      generateText:async(...args)=>(await ensure()).generateText!(...args),
      dispose:async()=>{disposed=true;await runtime?.dispose();await dormant.dispose();router.stop();listeners.clear();},
    };
  },
};
