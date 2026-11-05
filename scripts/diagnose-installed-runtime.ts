// Disposable verification runner only. Exact service against installed resources.
import {ManagedRuntimeService} from '../server/managed-runtime.ts';
import {join} from 'node:path';
const service = new ManagedRuntimeService({resourcesRoot:process.argv[2]!, dataDir:join(process.env.RUNNER_TEMP!, 'isolated-runtime-diagnosis'),startModelRoute:async()=>{}});
try {await service.install('hermes'); console.log('DIRECT_INSTALLED_HERMES_VERIFY_PASS');}
catch(error) {console.error('DIRECT_INSTALLED_HERMES_VERIFY_FAILURE',error);}
finally {await service.stop();}
