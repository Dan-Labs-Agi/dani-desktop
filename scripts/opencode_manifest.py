#!/usr/bin/env python3
"""Emit manifest v1 for an OpenCode runtime payload.

Schema v1 (validated by the app's managed-runtime zod schema):
  {manifestVersion, name, target, version, upstreamCommit, archiveSha256, archiveSize,
   unpackedSize, format, executableRelPath, probe:{argv, protocol, expectedVersion,
   expectedAgentName}, noticeRelPath, sbomRelPath, degradations[]}

Run AFTER the archive is built: archive hash/size are computed here, so the manifest
always describes the shipped bytes, never the intent. Targets use the app's naming
(linux-x64, darwin-arm64, darwin-x64, win32-x64); win32 probes must end in .cmd and
darwin-x64 must declare at least one degradation (the baseline Intel build).
"""
import argparse, hashlib, json, os

def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()

def size(root):
    return sum(os.path.getsize(os.path.join(b, f)) for b, _, fs in os.walk(root)
               for f in fs if not os.path.islink(os.path.join(b, f)))

p = argparse.ArgumentParser()
p.add_argument('--target', required=True,
               choices=['linux-x64', 'darwin-arm64', 'darwin-x64', 'win32-x64'])
p.add_argument('--payload-dir', required=True)
p.add_argument('--archive', required=True)
p.add_argument('--out', required=True)
a = p.parse_args()

is_win = a.target.startswith('win32-')
degradations = []
if a.target == 'darwin-x64':
    degradations = ['baseline-x64: Intel Mac payload uses the upstream x86-64 baseline '
                    'build (no AVX instructions) for CPU compatibility; throughput is '
                    'reduced versus AVX-enabled builds']

m = {
    'manifestVersion': 1,
    'name': 'opencode-runtime-payload',
    'target': a.target,
    'version': '1.18.32',
    'upstreamCommit': 'f5ce4f881e477c7b75421cea2d20939f0ddd71fb',
    'archiveSha256': sha(a.archive),
    'archiveSize': os.path.getsize(a.archive),
    'unpackedSize': size(a.payload_dir),
    'format': 'tar.gz',
    'executableRelPath': 'bin/opencode-acp.cmd' if is_win else 'bin/opencode-acp',
    'probe': {
        'expectedAgentName': 'OpenCode',
        'argv': ['probe\\run-probe.cmd'] if is_win else ['probe/run-probe.sh'],
        'protocol': 'acp-jsonrpc-stdio: spawn executableRelPath, send initialize '
                    '{protocolVersion:1, clientCapabilities:{fs:{readTextFile:false,'
                    'writeTextFile:false}, terminal:false}}, expect result.agentInfo',
        'expectedVersion': '1.18.32',
    },
    'noticeRelPath': 'NOTICE',
    'sbomRelPath': 'SBOM.cdx.json',
    'degradations': degradations,
}
json.dump(m, open(a.out, 'w'), indent=2)
print(m['archiveSha256'])
