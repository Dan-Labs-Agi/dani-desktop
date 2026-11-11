import test from "node:test";
import assert from "node:assert/strict";
import { installDesktopZoom } from "./desktop-zoom.mjs";

function fixture(level = 0) {
  let listener;
  return {
    webContents: {
      on: (name, callback) => { if (name === "before-input-event") listener = callback; },
      getZoomLevel: () => level,
      setZoomLevel: (next) => { level = next; },
    },
    key(input) {
      let prevented = false;
      listener({ preventDefault: () => { prevented = true; } }, { type: "keyDown", ...input });
      return { level, prevented };
    },
  };
}

test("zooms the desktop UI with the standard modified keys", () => {
  const page = fixture();
  installDesktopZoom(page.webContents);
  assert.deepEqual(page.key({ control: true, key: "=" }), { level: 1, prevented: true });
  assert.deepEqual(page.key({ control: true, key: "-" }), { level: 0, prevented: true });
  assert.deepEqual(page.key({ meta: true, code: "NumpadAdd" }), { level: 1, prevented: true });
  assert.deepEqual(page.key({ control: true, key: "0" }), { level: 0, prevented: true });
});

test("leaves ordinary typing alone and bounds zoom", () => {
  const page = fixture(5);
  installDesktopZoom(page.webContents);
  assert.deepEqual(page.key({ control: true, key: "+" }), { level: 5, prevented: true });
  assert.deepEqual(page.key({ key: "+" }), { level: 5, prevented: false });
});
