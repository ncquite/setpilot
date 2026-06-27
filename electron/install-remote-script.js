// Installs the bundled "SetPilot" control surface (the vendored AbletonOSC remote
// script) into Ableton's Remote Scripts folder: copy remote-script/SetPilot/ in,
// stamp it with our version, and tell the user to restart Live. main.js drives
// the prompts — we never write silently.

import { app, dialog } from "electron";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { cp, mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const FOLDER_NAME = "SetPilot"; // becomes the Control Surface name in Live
const STAMP_FILE = ".setpilot-install.json";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")
);

const exists = (p) => stat(p).then(() => true, () => false);

// Where the source folder lives — repo in dev, app resources when packaged.
function getSourceDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "remote-script", FOLDER_NAME);
  }
  return fileURLToPath(new URL("../remote-script/" + FOLDER_NAME, import.meta.url));
}

// Live's default Remote Scripts directory. null on unsupported platforms.
function getDefaultRemoteScriptsDir() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Music", "Ableton", "User Library", "Remote Scripts");
  }
  if (process.platform === "win32") {
    return path.join(home, "Documents", "Ableton", "User Library", "Remote Scripts");
  }
  return null; // Live runs only on macOS / Windows
}

// Inspect what's installed so the caller can decide whether to prompt.
export async function getInstallState() {
  const remoteScriptsDir = getDefaultRemoteScriptsDir();
  const supported = remoteScriptsDir !== null;
  const destDir = supported ? path.join(remoteScriptsDir, FOLDER_NAME) : null;

  let installedVersion = null;
  if (destDir && (await exists(path.join(destDir, STAMP_FILE)))) {
    try {
      const stamp = JSON.parse(await readFile(path.join(destDir, STAMP_FILE), "utf8"));
      installedVersion = stamp.version ?? null;
    } catch {
      installedVersion = null; // unreadable stamp → treat as needing reinstall
    }
  }

  const currentVersion = pkg.version;
  // Can we use the default location without asking? Yes if the Remote Scripts
  // dir (or its parent User Library) already exists — i.e. Live has been set up.
  const baseUsable =
    supported &&
    ((await exists(remoteScriptsDir)) || (await exists(path.dirname(remoteScriptsDir))));

  return {
    supported,
    remoteScriptsDir,
    destDir,
    installedVersion,
    currentVersion,
    isInstalled: installedVersion !== null,
    needsInstall: installedVersion !== currentVersion, // missing OR stale
    baseUsable,
  };
}

// Copy the script into <remoteScriptsDir>/SetPilot, replacing any prior copy,
// and write the version stamp. Returns the destination path.
export async function installTo(remoteScriptsDir) {
  const src = getSourceDir();
  if (!(await exists(src))) {
    throw new Error("Bundled control surface not found at: " + src);
  }
  const dest = path.join(remoteScriptsDir, FOLDER_NAME);

  await mkdir(remoteScriptsDir, { recursive: true });
  await rm(dest, { recursive: true, force: true }); // clean replace, no stale files
  await cp(src, dest, { recursive: true });

  await writeFile(
    path.join(dest, STAMP_FILE),
    JSON.stringify(
      {
        name: "setpilot-remote-script",
        version: pkg.version,
        source: "AbletonOSC (https://github.com/ideoforms/AbletonOSC)",
        sourceCommit: "0ca68214bd62c9b5cb641ca34006cfd70ba94430",
        installedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );

  return dest;
}

// Ask the user to point at their Remote Scripts folder (manual fallback when the
// default location can't be found). Returns the chosen path or null if cancelled.
async function pickRemoteScriptsDir(win) {
  await dialog.showMessageBox(win, {
    type: "info",
    title: "Locate Remote Scripts folder",
    message: "Choose Ableton's Remote Scripts folder",
    detail:
      "We couldn't find Ableton's Remote Scripts folder automatically.\n\n" +
      "In the next dialog, select:\n" +
      "  …/Ableton/User Library/Remote Scripts\n\n" +
      "(In Live: Preferences → Library → User Library shows its location.)",
    buttons: ["Choose Folder…", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });

  const res = await dialog.showOpenDialog(win, {
    title: "Select Ableton's Remote Scripts folder",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Install Here",
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
}

// Full interactive flow. `trigger` is "startup" (skippable, remembered) or
// "manual" (always prompts). Returns a short status string.
export async function promptAndInstall(win, trigger = "startup") {
  const state = await getInstallState();

  if (!state.supported) {
    if (trigger === "manual") {
      await dialog.showMessageBox(win, {
        type: "info",
        title: "Not supported",
        message: "Ableton Live runs only on macOS and Windows",
        detail: "The control surface can't be installed on this platform.",
        buttons: ["OK"],
      });
    }
    return "unsupported";
  }

  if (trigger === "startup" && !state.needsInstall) return "current";

  if (trigger === "startup" && (await wasSkipped(state.currentVersion))) {
    return "skipped-previously";
  }

  // Already current and the user asked manually — offer reinstall.
  const isUpdate = state.isInstalled && state.needsInstall;
  const message = "Install the SetPilot control surface for Ableton?";
  const detail =
    (isUpdate
      ? `An update is available (installed ${state.installedVersion}, bundled ${state.currentVersion}).\n\n`
      : trigger === "manual" && state.isInstalled
        ? `Already installed (version ${state.installedVersion}). You can reinstall it.\n\n`
        : "") +
    "This copies SetPilot's control surface into Ableton's Remote Scripts folder " +
    "so Live can talk to the app.\n\n" +
    "After installing, restart Ableton Live and choose “SetPilot” under " +
    "Preferences → Link / Tempo / MIDI → Control Surface.";

  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    title: "SetPilot control surface",
    message,
    detail,
    buttons: state.isInstalled ? ["Reinstall", "Not Now"] : ["Install", "Not Now"],
    defaultId: 0,
    cancelId: 1,
  });

  if (response !== 0) {
    if (trigger === "startup") await rememberSkip(state.currentVersion);
    return "declined";
  }

  // Resolve where to install: default location, or ask the user.
  let targetDir = state.baseUsable ? state.remoteScriptsDir : await pickRemoteScriptsDir(win);
  if (!targetDir) return "cancelled";

  try {
    const dest = await installTo(targetDir);
    await dialog.showMessageBox(win, {
      type: "info",
      title: "Control surface installed",
      message: "Installed — now restart Ableton Live",
      detail:
        `Installed to:\n${dest}\n\n` +
        "1. Restart Ableton Live.\n" +
        "2. Preferences → Link / Tempo / MIDI → Control Surface → select “SetPilot”.",
      buttons: ["OK"],
    });
    return "installed";
  } catch (err) {
    await dialog.showMessageBox(win, {
      type: "error",
      title: "Install failed",
      message: "Couldn't install the control surface",
      detail: String(err?.message || err),
      buttons: ["OK"],
    });
    return "error";
  }
}

// Remember a per-version "Not Now" so startup doesn't nag every launch.
function prefsPath() {
  return path.join(app.getPath("userData"), "install-prefs.json");
}
async function readPrefs() {
  try {
    return JSON.parse(await readFile(prefsPath(), "utf8"));
  } catch {
    return {};
  }
}
async function wasSkipped(version) {
  const prefs = await readPrefs();
  return prefs.skipInstallForVersion === version;
}
async function rememberSkip(version) {
  const prefs = await readPrefs();
  prefs.skipInstallForVersion = version;
  try {
    await writeFile(prefsPath(), JSON.stringify(prefs, null, 2) + "\n");
  } catch {
    // best-effort; if we can't persist, worst case we ask again next launch
  }
}
