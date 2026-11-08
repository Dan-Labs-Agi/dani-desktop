#!/usr/bin/env python3
"""Bind reusable managed-Hermes archives to the exact local builder recipe."""
import argparse
import hashlib
import json
from pathlib import Path

RECIPE_FILES = (
    'build-hermes-payload.sh', 'hermes_manifest.py', 'hermes_payload_recipe.py',
    'hermes_target_reqs.py', 'hermes_wheelhouse.py', 'hermes_sbom.py',
    'pbs-digests.json', 'license-fallbacks.json',
    'payload-probe/acp_probe.py', 'payload-probe/run-probe.sh', 'payload-probe/run-probe.cmd',
)

def recipe_digest(root=None):
    root = Path(root) if root is not None else Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for name in RECIPE_FILES:
        digest.update(name.encode() + b'\0')
        content = (root / name).read_bytes().replace(b'\r\n', b'\n')
        digest.update(len(content).to_bytes(8, 'big'))
        digest.update(content)
    return digest.hexdigest()

def manifest_matches(path):
    try:
        return json.loads(Path(path).read_text()).get('buildRecipeSha256') == recipe_digest()
    except (OSError, ValueError, TypeError, AttributeError):
        return False

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--matches', metavar='MANIFEST')
    args = parser.parse_args()
    if args.matches:
        if not manifest_matches(args.matches):
            raise SystemExit('Hermes payload build recipe is stale or missing; rebuild the bundled archive.')
    else:
        print(recipe_digest())
