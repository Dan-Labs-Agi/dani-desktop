import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const data = read('electron/resources/app-icon.png').toString('base64');
test('platform and web icons use the unchanged approved Dani image', () => {
  assert.deepEqual(read('build/icon-1024.png'), read('electron/resources/app-icon.png'));
  for (const path of ['build/icon.svg', 'public/app-icon.svg']) assert.ok(read(path).toString().includes(data));
});
test('web, Linux and iconset images have transparent outside corners', () => {
  for (const path of ['build/icon-1024.png','public/app-icon-192.png','public/app-icon-512.png','public/apple-touch-icon.png', ...[16,32,64,128,256,512].flatMap(n => [`build/icon.iconset/icon_${n}x${n}.png`,`build/icon.iconset/icon_${n}x${n}@2x.png`])]) {
    const image = read(path).toString('base64');
    const render = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image width="64" height="64" href="data:image/png;base64,${image}"/></svg>`).render();
    for (const pixel of [0,63,63*64,64*64-1]) assert.equal(render.pixels[pixel*4+3], 0, path);
  }
});
test('DMG artwork only embeds the approved character and keeps Finder target geometry', () => {
  const svg = read('build/dmg/background.svg').toString();
  assert.ok(svg.includes(data)); assert.equal((svg.match(/<image /g) ?? []).length,1);
  assert.ok(!svg.includes('M288 206')); assert.ok(!svg.includes('#b88cf5'));
  assert.ok(!svg.includes('cast-front')); assert.ok(!svg.includes('cast-mid'));
  const builder = read('electron-builder.yml').toString();
  assert.ok(builder.includes('x: 180\n      y: 206')); assert.ok(builder.includes('x: 540\n      y: 206'));
});
test('legacy development gallery opens only the approved character family', () => {
  const preview = read('src/mascot-preview.tsx').toString();
  assert.ok(preview.includes("import './robot-preview'")); assert.ok(!preview.includes('<MausAvatar'));
});
