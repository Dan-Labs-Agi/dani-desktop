// Disposable verification runner only. Exact service against installed resources.
import {ManagedRuntimeService} from '../server/managed-runtime.ts';
import {execFileSync} from 'node:child_process';
import {hermesLaunch} from '../server/drivers/acp/hermes.ts';
import {join} from 'node:path';
const service = new ManagedRuntimeService({resourcesRoot:process.argv[2]!, dataDir:join(process.env.RUNNER_TEMP!, 'isolated-runtime-diagnosis')});
try {
 await service.install('hermes');console.log('DIRECT_INSTALLED_HERMES_VERIFY_PASS');
 const exe=service.executable('hermes')!;
 const env={...process.env,DANI_MANAGED_HERMES_EXECUTABLE:exe};
 try {execFileSync(exe,['--version'],{env,timeout:10000});console.log('RAW_CMD_VERSION_PASS');}
 catch(error) {console.log('RAW_CMD_VERSION_FAIL',String(error));}
 const launch=hermesLaunch(exe,['--version'],env);
 console.log('NATIVE_MANAGED_VERSION',execFileSync(launch.command,launch.args,{env:launch.env,timeout:15000,encoding:'utf8'}));
 await service.install('opencode');service.startBootstrap();
 for(let i=0;i<100;i++) {
  const status=service.bootstrapStatus();
  if(status.state==='ready'||status.state==='repairable-error'){console.log('DIRECT_ROUTE_STATUS',JSON.stringify(status));break;}
  await new Promise(r=>setTimeout(r,1000));
 }
} catch(error) {console.error('DIRECT_INSTALLED_VERIFY_FAILURE',error);}
finally {await service.stop();}
