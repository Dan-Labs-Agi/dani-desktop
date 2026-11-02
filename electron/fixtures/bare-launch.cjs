// Minimal Electron launch: no app code, no sandbox helpers, no window.
// Used by bare-launch.electron.test.mjs to separate Windows runner
// environment from product defects in the Electron startup crash class.
console.log("bare-fixture-entered");
const { app } = require("electron");
console.log("bare-fixture-modules-loaded");
const timer = setTimeout(() => {
  console.log("bare-timeout");
  app.exit(3);
}, 20000);
app.whenReady().then(() => {
  clearTimeout(timer);
  console.log("bare-ready");
  app.exit(0);
});
