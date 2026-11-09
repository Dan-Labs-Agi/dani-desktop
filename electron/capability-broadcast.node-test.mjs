import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastCapabilities} from './capability-broadcast.mjs';
test('local windows receive native capabilities, remote or invalid origins receive redacted data',async()=>{
 const sent=[],built=[];const window=(name,url,destroyed=false)=>({isDestroyed:()=>destroyed,webContents:{getURL:()=>url,send:(channel,value)=>sent.push({name,channel,value})}});
 await broadcastCapabilities({connection:Promise.resolve('native'),build:(remote,connection)=>{built.push({remote,connection});return {remote}},rail:{send:(channel,value)=>sent.push({name:'rail',channel,value})},windows:()=>[window('local','http://127.0.0.1:8799/x'),window('remote','https://other.test'),window('bad','not a URL'),window('gone','http://127.0.0.1:8799',true)],origin:()=> 'http://127.0.0.1:8799'});
 assert.deepEqual(sent.map(({name,value})=>({name,value})),[{name:'rail',value:{remote:false}},{name:'local',value:{remote:false}},{name:'remote',value:{remote:true}},{name:'bad',value:{remote:true}}]);assert.deepEqual(built,[{remote:false,connection:'native'},{remote:true,connection:'native'}]);
});
