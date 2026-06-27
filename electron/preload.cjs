// Reports the rendered content height to the main process so the window can
// shrink/grow to fit. Used by both the main window (.app) and the MIDI Control
// window (.settings). Overlays (.toast, .modal-backdrop) are position:fixed, so
// the in-flow container is the true content height.

const { ipcRenderer } = require("electron");

const SELECTOR = ".app, .settings";

function reportHeight() {
  const el = document.querySelector(SELECTOR);
  if (!el) return;
  ipcRenderer.send("set-content-height", Math.ceil(el.getBoundingClientRect().height));
}

window.addEventListener("DOMContentLoaded", () => {
  const el = document.querySelector(SELECTOR);
  if (el) new ResizeObserver(reportHeight).observe(el);
  reportHeight();
});
