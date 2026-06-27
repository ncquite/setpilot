// SetPilot desktop shell.
//
// Boots the same server in-process (so Ableton control + the LAN remote keep
// working exactly as with `npm start`) and shows the UI in a native window.
// Phones/tablets can still connect to the printed LAN URL at the same time.

import { app, BrowserWindow, Menu, dialog, ipcMain, screen, shell, session } from "electron";
import { fileURLToPath } from "node:url";
import { startServer } from "../src/server.js";
import { promptAndInstall } from "./install-remote-script.js";

const preloadPath = fileURLToPath(new URL("preload.cjs", import.meta.url));

let win;
let midiWin = null;
let serverUrl = null; // base URL of the in-process server, set on boot

// Open (or focus) the MIDI Control settings window — a normal resizable window,
// separate from the tall performance window so it doesn't clutter it.
function openMidiWindow() {
  if (midiWin && !midiWin.isDestroyed()) {
    midiWin.focus();
    return;
  }
  midiWin = new BrowserWindow({
    width: 460,
    height: 520, // starting height; auto-fits to content after load
    minWidth: 460, // fixed width to match the main window
    maxWidth: 460,
    minHeight: 120,
    useContentSize: true, // width/height refer to the web content, not the frame
    title: "SetPilot — Configure MIDI Control",
    backgroundColor: "#0e0e11",
    parent: win,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: preloadPath },
  });
  midiWin.setMenuBarVisibility(false);
  midiWin.loadURL(`${serverUrl}/midi.html`);
  midiWin.on("closed", () => {
    midiWin = null;
  });
}

// Resize whichever window sent the report to its content height, clamped to the
// available screen height. Width stays fixed. Works for both the main window and
// the MIDI Control window (both load the same height-reporting preload).
ipcMain.on("set-content-height", (event, height) => {
  const bw = BrowserWindow.fromWebContents(event.sender);
  if (!bw || bw.isDestroyed()) return;
  const [width] = bw.getContentSize();
  const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const next = Math.min(Math.max(height, 120), screenHeight);
  if (Math.abs(next - bw.getContentSize()[1]) > 1) bw.setContentSize(width, next, false);
});

// Native menu with an About item that shows the copyright / license popup.
// We keep the standard Edit/View/Window menus so copy-paste, quit, etc. work.
function buildMenu() {
  const isMac = process.platform === "darwin";

  const about = {
    label: "About SetPilot",
    click: () =>
      dialog.showMessageBox(win, {
        type: "info",
        title: "About SetPilot",
        message: "SetPilot",
        detail:
          "Setlist control for Ableton Live.\n\n" +
          "© 2026 SetPilot\n" +
          "Licensed under AGPL-3.0-or-later.",
        buttons: ["OK"],
      }),
  };

  const installItem = {
    label: "Install Ableton Control Surface",
    click: () => promptAndInstall(win, "manual"),
  };

  const midiItem = {
    label: "Configure MIDI Control",
    accelerator: "CmdOrCtrl+,",
    click: () => openMidiWindow(),
  };

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              about,
              { type: "separator" },
              midiItem,
              installItem,
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    ...(isMac ? [] : [{ role: "help", submenu: [midiItem, installItem, about] }]),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const { url } = await startServer();
  serverUrl = url; // used to open the MIDI Control window

  // The window only ever shows our own localhost UI (external links open in the
  // system browser), so we can safely grant the permissions it asks for — namely
  // Web MIDI, used to read a footswitch/controller, and the screen wake lock.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  win = new BrowserWindow({
    width: 460,
    height: 700, // starting height; the window auto-fits to content after load
    minWidth: 460, // fixed width — width can't be dragged
    maxWidth: 460,
    minHeight: 120,
    useContentSize: true, // width/height refer to the web content, not the frame
    backgroundColor: "#0b0717", // matches the app background so there's no flash
    title: "SetPilot",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  buildMenu();

  win.once("ready-to-show", () => {
    win.show();
    // First-run / update check: offer to install the control surface. Skippable
    // and remembered per version, so it won't nag on every launch.
    promptAndInstall(win, "startup").catch(() => {});
  });
  win.loadURL(url);

  // Keep external links (docs, etc.) in the system browser, not the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => app.quit());
