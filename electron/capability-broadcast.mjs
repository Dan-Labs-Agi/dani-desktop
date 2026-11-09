// Native capabilities go to own local windows; every other window receives the redacted view.
export async function broadcastCapabilities({ connection, build, rail, windows, origin }) {
  const localConnection = await connection;
  const local = build(false, localConnection);
  rail.send('desktop:capabilities-changed', local);
  let redacted = null;
  for (const window of windows()) {
    if (window.isDestroyed()) continue;
    let isLocal = false;
    try { isLocal = new URL(window.webContents.getURL()).origin === origin(); } catch {}
    if (!isLocal) redacted ??= build(true, localConnection);
    window.webContents.send('desktop:capabilities-changed', isLocal ? local : redacted);
  }
}
