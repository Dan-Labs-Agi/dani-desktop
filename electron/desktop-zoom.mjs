const MIN_ZOOM_LEVEL = -5;
const MAX_ZOOM_LEVEL = 5;

export function installDesktopZoom(webContents) {
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta)) return;
    const zoomIn = input.key === "+" || input.key === "=" || input.code === "NumpadAdd";
    const zoomOut = input.key === "-" || input.code === "NumpadSubtract";
    const reset = input.key === "0" || input.code === "Numpad0";
    if (!zoomIn && !zoomOut && !reset) return;
    event.preventDefault();
    const level = reset ? 0 : Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, webContents.getZoomLevel() + (zoomIn ? 1 : -1)));
    webContents.setZoomLevel(level);
  });
}
