#!/usr/bin/env python3
"""Run locally with python3 scripts/hermes_payload_recipe_test.py. No native runtime or network."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from hermes_payload_recipe import recipe_digest

SCRIPTS = Path(__file__).resolve().parent

class PayloadRecipeTests(unittest.TestCase):
    def test_recipe_is_stable_across_line_endings_and_changes_with_builder(self):
        import hermes_payload_recipe as recipe
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in recipe.RECIPE_FILES:
                p=root/name; p.parent.mkdir(parents=True,exist_ok=True)
                p.write_bytes((SCRIPTS/name).read_bytes().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'))
            self.assertEqual(recipe_digest(root),recipe_digest())
            with (root/'build-hermes-payload.sh').open('ab') as f: f.write(b'\n# changed recipe\n')
            self.assertNotEqual(recipe_digest(root),recipe_digest())

    def test_dependency_install_errors_abort_builder(self):
        source = (SCRIPTS/'build-hermes-payload.sh').read_text()
        for start, end in [('uv pip install --target', 'if [ "$TARGET" = win-x64 ]; then'), ('  uv pip install --target', '\nfi\n\n# Portable copy')]:
            pos = source.index(start)
            block = source[pos:source.index(end, pos)]
            with self.subTest(command=start), tempfile.TemporaryDirectory() as tmp:
                script = ('set -eu\nWORK='+tmp+'\nPAYLOAD='+tmp+'\nUV_PLAT=x\nWH='+tmp+
                          '\nuv() { echo simulated-install-error >&2; return 37; }\n'+block+'\necho SHOULD_NOT_REACH\n')
                result = subprocess.run(['sh'], input=script, text=True, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('simulated-install-error', result.stderr)
                self.assertNotIn('SHOULD_NOT_REACH', result.stdout)

    def test_all_platforms_reject_stale_cache_and_stage_current_recipe(self):
        for target,build in [('linux-x64','linux-x64'),('darwin-arm64','mac-arm64'),('darwin-x64','mac-x64'),('win32-x64','win-x64')]:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);source=root/'source';dest=root/'dest';source.mkdir();dest.mkdir()
                archive=source/f'hermes-payload-{build}-v2026.9.21.tar.gz';archive.write_bytes(b'synthetic archive; no runtime code')
                manifest=source/f'hermes-payload-{build}-v2026.9.21.manifest.json'
                m={'manifestVersion':1,'name':'hermes-runtime-payload','target':build,'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'archiveSize':archive.stat().st_size,'probe':{'argv':['probe/run-probe.cmd' if target=='win32-x64' else 'probe/run-probe.sh'],'expectedAgentName':'hermes-agent','expectedVersion':'0.21.4'},'executableRelPath':'bin/hermes-acp.cmd' if target=='win32-x64' else 'bin/hermes-acp','degradations':['synthetic exclusion']}
                def stage():
                    return subprocess.run(['sh',str(SCRIPTS/'stage-hermes-payload.sh'),str(source),target,str(dest)],capture_output=True,text=True)
                for marker in [None,'0'*64]:
                    if marker is None:m.pop('buildRecipeSha256',None)
                    else:m['buildRecipeSha256']=marker
                    manifest.write_text(json.dumps(m));out=stage()
                    self.assertNotEqual(out.returncode,0);self.assertIn('stale or missing',out.stderr)
                    self.assertFalse((dest/'dist-native').exists())
                m['buildRecipeSha256']=recipe_digest();manifest.write_text(json.dumps(m));out=stage()
                self.assertEqual(out.returncode,0,out.stderr)
                staged=dest/'dist-native/managed-runtimes/manifests'/f'hermes-{target}.manifest.json'
                data=json.loads(staged.read_text());self.assertEqual(data['target'],target);self.assertEqual(data['buildRecipeSha256'],recipe_digest())
                # Even a current recipe marker must not bypass archive integrity.
                archive.write_bytes(b'corrupt');out=stage();self.assertNotEqual(out.returncode,0);self.assertIn('hash mismatch',out.stderr)

if __name__=='__main__':unittest.main(verbosity=2)
