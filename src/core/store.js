// Setlist persistence — plain JSON files in setpilot/setlists/.
// We store the order by song NAME (not cue index) so a saved set survives edits
// to the Live arrangement; on load we resolve names to whatever songs exist now.

import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SETLISTS_DIR = join(HERE, "..", "..", "setlists");

function fileFor(name) {
  const safe = name.replace(/[^a-z0-9-_ ]/gi, "").trim() || "untitled";
  return join(SETLISTS_DIR, `${safe}.json`);
}

/** @param {string} name @param {import("./songs.js").Song[]} orderedSongs */
export async function saveSetlist(name, orderedSongs) {
  await mkdir(SETLISTS_DIR, { recursive: true });
  const data = {
    name,
    savedAt: new Date().toISOString(),
    order: orderedSongs.map((s) => s.name),
  };
  await writeFile(fileFor(name), JSON.stringify(data, null, 2), "utf8");
  return data;
}

/**
 * Load a saved setlist and resolve its song names against the current songs.
 * @param {string} name
 * @param {import("./songs.js").Song[]} currentSongs
 * @returns {Promise<{name:string, resolved:import("./songs.js").Song[], missing:string[]}>}
 */
export async function loadSetlist(name, currentSongs) {
  const raw = JSON.parse(await readFile(fileFor(name), "utf8"));
  const byName = new Map(currentSongs.map((s) => [s.name, s]));
  const resolved = [];
  const missing = [];
  for (const songName of raw.order) {
    const song = byName.get(songName);
    if (song) resolved.push(song);
    else missing.push(songName); // locator was renamed or removed in Live
  }
  return { name: raw.name, resolved, missing };
}

/** List saved setlist names. */
export async function listSetlists() {
  try {
    const files = await readdir(SETLISTS_DIR);
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

export async function deleteSetlist(name) {
  try {
    await unlink(fileFor(name));
    return true;
  } catch {
    return false;
  }
}
