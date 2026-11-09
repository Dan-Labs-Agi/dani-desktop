// Installer/update deliverables only. Builder diagnostics have the same names on each OS and are not release assets.
export function releaseAssetNames(names, platform) {
  const binary = {
    linux: /^(?:DaniBot[^/\\]*\.(?:AppImage|deb)|danibot-amd64\.deb)(?:\.blockmap)?$/,
    windows: /^DaniBot[^/\\]*\.(?:exe|zip)(?:\.blockmap)?$/,
    macos: /^DaniBot[^/\\]*\.(?:dmg|zip)(?:\.blockmap)?$/,
  }[platform];
  const metadata = { linux: 'latest-linux.yml', windows: 'latest.yml', macos: 'latest-mac.yml' }[platform];
  if (!binary || !metadata) throw Error('Unknown release platform');
  return names.filter(name => binary.test(name) || name === metadata).sort();
}
