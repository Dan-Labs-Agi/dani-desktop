import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=readFileSync(new URL('../.github/workflows/tested-preview-download.yml',import.meta.url),'utf8');
test('private Intel candidate is opt-in, branch guarded and source pinned',()=>{
 assert.match(file,/workflow_dispatch:/);
 assert.match(file,/github.ref == 'refs\/heads\/fix\/intel-private-delivery-20261109'/);
 assert.match(file,/ref: 727a2eb2590d48fcf3181d6eebd10c7f710f3347/);
 assert.match(file,/test "\$\(git rev-parse HEAD\)" = "\$CANDIDATE_SOURCE"/);
 assert.match(file,/persist-credentials: false/);
 assert.match(file,/cancel-in-progress: false/);
});
test('only built-native-passed bytes can be retained, never replacing an existing candidate',()=>{
 const validation=file.indexOf('node scripts/verify-main-mac-installed.cjs');
 const retention=file.indexOf('gh release create');
 assert.ok(validation>0 && retention>validation);
 assert.match(file,/Candidate already exists; refuse replacement/);
 assert.match(file,/Tag already exists; refuse replacement/);
 assert.match(file,/--draft --prerelease/);
 assert.equal((file.match(/--clobber/g)||[]).length,1);
 assert.match(file,/gh release upload "\$CANDIDATE_TAG" "\$RUNNER_TEMP\/CANDIDATE.json" --clobber/);
 assert.doesNotMatch(file,/gh release (delete|edit)|--latest|upload-artifact@|cache@|pull_request_target/);
});
test('downloaded exact-byte check precedes a second real install in a fresh synthetic profile',()=>{
 assert.match(file,/gh release download "\$CANDIDATE_TAG" --pattern DaniBot-0.1.139-x64.dmg/);
 assert.match(file,/file.stat\(\).st_size==meta\['bytes'\]/);
 assert.match(file,/hashlib.sha256\(file.read_bytes\(\)\).hexdigest\(\)==meta\['sha256'\]/);
 assert.match(file,/RUNNER_TEMP="\$RUNNER_TEMP\/downloaded-profile" GITHUB_SHA="\$CANDIDATE_SOURCE" node scripts\/verify-main-mac-installed.cjs/);
 assert.equal((file.match(/grep -q MAIN_INSTALLED_RELAUNCH_PASS/g)||[]).length,2);
 assert.equal((file.match(/grep -q MAIN_INSTALLED_GRAPHICS_PASS/g)||[]).length,2);
 assert.equal((file.match(/grep -q DANI_FREE_PACKAGED_BUTTON_INSTALL_PASS/g)||[]).length,2);
});
test('candidate retains functional and security limits without live-model or override execution',()=>{
 assert.match(file,/Full test matrix is not passing; not production-ready/);
 assert.match(file,/Live Kilo model response is unverified/);
 assert.match(file,/Ad-hoc signing only/);
 assert.match(file,/actual browser\/Finder dialog are unverified/);
 assert.match(file,/DANI_VERIFY_FREE_INSTALL: '1'/);
 assert.doesNotMatch(file,/xattr\s+-[dr]|spctl\s+--(?:master-disable|global-disable)|click.*Open Anyway|DANI_FREE_PROBE_ON_REFRESH:\s*['"]?1/);
});
