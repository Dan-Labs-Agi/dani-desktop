// Diagnostic reads stay within explicit product profile/log directories.
// Never recurse into HOME, tool payloads, symlinks or container mounts.
const fs = require('node:fs');
const path = require('node:path');
function ownedProfileFiles(temp) {
  const found = [];
  for (const relative of ['profile', 'profile/logs', 'electron-user-data/logs']) {
    const directory = path.join(temp, relative);
    try {
      if (!fs.lstatSync(directory).isDirectory()) continue;
      for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
        if (entry.isFile() && /^(?:config\.json|server\.log|desktop-crashes\.log|runtime\.json|cua-local-control\.json)$/.test(entry.name)) found.push(path.join(relative, entry.name));
      }
    } catch (error) {
      console.error('DANI_DIAGNOSTIC_READ_FAILED', relative, error.code || error.message);
    }
  }
  return found;
}
module.exports = {ownedProfileFiles};
