"""Read-only security observation on a disposable Mac, never the user's Mac.
Downloads existing bytes with Safari; never approves exceptions or removes quarantine.
"""
import base64
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import urllib.parse

EXPECTED_HASH = 'd6a47338cab99d5227ea9e3e5bc0d231ef2d5150ee5e2edc9904917a3774f4bd'
EXPECTED_SIZE = 506002694
REPO = 'Dan-Labs-Agi/dani-desktop'
NAME = 'DaniBot-0.1.59-x64.dmg'


def run(args, required=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=90)
    if required and result.returncode:
        raise RuntimeError(args[0] + ' failed: ' + result.stderr[:500])
    return result


def osa(source, required=True):
    result = subprocess.run(['osascript', '-'], input=source, capture_output=True, text=True, timeout=90)
    if required and result.returncode:
        raise RuntimeError('AppleScript failed: ' + result.stderr[:500])
    return result


def quoted(value):
    return json.dumps(str(value))


def emit(value):
    print('QUARANTINE_OBSERVATION ' + json.dumps(value), flush=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def screenshot(directory, label):
    file = directory / (label + '.png')
    run(['/usr/sbin/screencapture', '-x', str(file)])
    encoded = base64.b64encode(file.read_bytes()).decode()
    for position in range(0, len(encoded), 32000):
        print('QUARANTINE_' + label + '_CHUNK:' + encoded[position:position + 32000], flush=True)
    print('QUARANTINE_' + label + '_END', flush=True)


def main():
    if os.uname().sysname != 'Darwin':
        raise RuntimeError('This observation requires native macOS')
    token = os.environ.pop('GH_TOKEN')
    headers = {'Authorization': 'Bearer ' + token, 'User-Agent': 'Dani-private-install-verification',
               'Accept': 'application/vnd.github+json'}
    root = 'https://api.github.com/repos/' + REPO
    releases = json.load(urllib.request.urlopen(urllib.request.Request(root + '/releases?per_page=100', headers=headers), timeout=30))
    release = next((r for r in releases if r['id'] == 438594031), None)
    if release is None:
        raise RuntimeError('Job token cannot see the approved private draft; stop before Safari')
    if not release['draft'] or release['target_commitish'] != '35ec74d00e809f0339cf238f76ea723fba59c456':
        raise RuntimeError('Expected immutable private repair draft/source not found')
    asset = next(a for a in release['assets'] if a['name'] == NAME)
    if asset['size'] != EXPECTED_SIZE:
        raise RuntimeError('Draft asset size changed')
    if not asset['url'].startswith(root + '/releases/assets/'):
        raise RuntimeError('Unexpected asset API origin')
    headers['Accept'] = 'application/octet-stream'
    try:
        urllib.request.build_opener(NoRedirect).open(urllib.request.Request(asset['url'], headers=headers), timeout=30)
        raise RuntimeError('Asset route did not return a browser-download redirect')
    except urllib.error.HTTPError as error:
        if error.code != 302:
            raise RuntimeError('Asset browser redirect unavailable, HTTP ' + str(error.code)) from None
        download_url = error.headers['Location']
        parsed = urllib.parse.urlparse(download_url)
        if parsed.scheme != 'https' or parsed.hostname != 'release-assets.githubusercontent.com':
            raise RuntimeError('Unexpected asset download origin')
    # The short-lived private URL stays in process memory and Safari only, never logs.
    del headers, token
    downloads = pathlib.Path.home() / 'Downloads'
    if (downloads / NAME).exists():
        raise RuntimeError('Download destination already exists; refusing ambiguous bytes')
    directory = pathlib.Path(tempfile.mkdtemp(prefix='dani-quarantine-observation-'))
    osa('tell application "Safari"\nactivate\nopen location ' + quoted(download_url) + '\nend tell')
    del download_url
    file = downloads / NAME
    end = time.monotonic() + 240
    while time.monotonic() < end:
        if file.exists() and file.stat().st_size == EXPECTED_SIZE:
            break
        time.sleep(2)
    else:
        raise RuntimeError('Safari download did not complete; no curl substitute or acceptance claim')
    osa('tell application "Safari" to quit')
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    if digest != EXPECTED_HASH:
        raise RuntimeError('Browser-downloaded artifact hash mismatch')
    quarantine = run(['/usr/bin/xattr', '-p', 'com.apple.quarantine', str(file)], required=False)
    emit({'event': 'browser-exact-bytes', 'browser': 'Safari', 'sha256': digest, 'bytes': file.stat().st_size,
          'quarantine_present': quarantine.returncode == 0})
    if quarantine.returncode:
        raise RuntimeError('Safari bytes have no quarantine attribute; not real quarantine proof')
    mount = directory / 'mounted'
    mount.mkdir()
    mounted = False
    try:
        run(['hdiutil', 'attach', str(file), '-nobrowse', '-mountpoint', str(mount)])
        mounted = True
        destination = directory / 'Applications'
        destination.mkdir()
        # Finder performs the actual app copy, including its quarantine propagation.
        osa('tell application "Finder"\nduplicate (POSIX file ' + quoted(mount / 'Dani Bot.app') + ') to (POSIX file ' + quoted(destination) + ')\nend tell')
        bundle = destination / 'Dani Bot.app'
        verify = run(['codesign', '--verify', '--deep', '--strict', str(bundle)], required=False)
        emit({'event': 'copied-signature-integrity', 'status': verify.returncode, 'stderr': verify.stderr})
        if verify.returncode:
            raise RuntimeError('Copied bundle signature damaged; do not open or approve it')
        app_quarantine = run(['/usr/bin/xattr', '-p', 'com.apple.quarantine', str(bundle)], required=False)
        emit({'event': 'finder-copied-app', 'quarantine_present': app_quarantine.returncode == 0})
        if app_quarantine.returncode:
            raise RuntimeError('Finder app quarantine not verified; no mutation to force the expected result')
        opened = run(['open', str(bundle)], required=False)
        time.sleep(8)
        screenshot(directory, 'FINDER_ALERT')
        emit({'event': 'ordinary-open', 'status': opened.returncode, 'stderr': opened.stderr})
        # Read alerts only. Do not click any Open/Allow/Done/Delete buttons.
        alerts = osa('tell application "System Events"\nget {name, value} of every static text of every window of every process whose visible is true\nend tell', required=False)
        emit({'event': 'alert-accessibility', 'status': alerts.returncode, 'text': alerts.stdout[:10000], 'error': alerts.stderr[:500]})
        run(['open', 'x-apple.systempreferences:com.apple.preference.security?General'], required=False)
        time.sleep(8)
        screenshot(directory, 'PRIVACY_SECURITY')
        controls = osa('tell application "System Events"\ntell process "System Settings"\nget name of every button of entire contents of front window\nend tell\nend tell', required=False)
        emit({'event': 'security-panel-controls', 'status': controls.returncode, 'text': controls.stdout[:10000], 'error': controls.stderr[:500],
              'exception_clicked': False, 'quarantine_removed': False, 'global_policy_changed': False})
    finally:
        if mounted:
            run(['hdiutil', 'detach', str(mount)], required=False)


if __name__ == '__main__':
    main()
