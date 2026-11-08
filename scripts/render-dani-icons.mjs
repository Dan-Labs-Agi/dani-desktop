// The approved Dani character is shared with the desktop startup screen. Never redraw it here.
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('electron/resources/app-icon.png', root));
const image = `<image width="1024" height="1024" href="data:image/png;base64,${source.toString('base64')}"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><title>Dani</title>${image}</svg>\n`;
const png = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
const write = (path, bytes) => writeFileSync(new URL(path, root), bytes);
write('build/icon-1024.png', source);
write('build/icon.svg', svg);
write('public/app-icon.svg', svg);
for (const [name, size] of [['app-icon-192.png', 192], ['app-icon-512.png', 512], ['apple-touch-icon.png', 180]]) write(`public/${name}`, png(size));
for (const size of [16, 32, 64, 128, 256, 512]) {
  write(`build/icon.iconset/icon_${size}x${size}.png`, png(size));
  write(`build/icon.iconset/icon_${size}x${size}@2x.png`, png(size * 2));
}
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = sizes.map(png);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [i, size] of sizes.entries()) {
  const at = 6 + i * 16;
  header[at] = header[at + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(frames[i].length, at + 8); header.writeUInt32LE(offset, at + 12);
  offset += frames[i].length;
}
write('build/icon.ico', Buffer.concat([header, ...frames]));
const entries = [['icp4',16], ['icp5',32], ['icp6',64], ['ic07',128], ['ic08',256], ['ic09',512], ['ic10',1024]].map(([kind,size]) => {
  const data = png(size); const head = Buffer.alloc(8);
  head.write(kind); head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
});
const icns = Buffer.alloc(8); icns.write('icns'); icns.writeUInt32BE(8 + entries.reduce((n,e) => n + e.length, 0), 4);
write('build/icon.icns', Buffer.concat([icns, ...entries]));
console.log('Dani icons regenerated from electron/resources/app-icon.png');
