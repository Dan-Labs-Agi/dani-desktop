const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Playwright1.56 waitForFunction treats an async predicate's Promise as truthy,
// then unwraps even a false result. Poll awaited evaluate results in Node instead.
async function waitDaniFreeSetup(page, {timeout=240000, sleep=pause, now=Date.now}={}) {
 const deadline=now()+timeout;
 while(now()<deadline){
  const status=await page.evaluate(async()=>{
   const response=await fetch('/api/instances/dani-free/setup');
   if(!response.ok)throw Error('Setup status HTTP '+response.status);
   return response.json();
  });
  if(status.phase==='failed'||status.phase==='unsupported')throw Error(status.message);
  if(status.phase==='installed'){assert.equal(status.modelReady,false);return status;}
  await sleep(1000);
 }
 throw Error('Dani Free setup did not finish before the verification deadline');
}
module.exports={waitDaniFreeSetup};
