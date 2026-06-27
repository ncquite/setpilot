// Shared MIDI helpers used by both the main window (runtime: fire mapped actions)
// and the MIDI Control settings window (learn/assign UI). Keeping the function
// list and parsing in one place means the two windows can't drift apart.

// The mappable transport functions. The actual behaviour (what each one does)
// lives in the main window, keyed by id — these are just id + label.
export const MIDI_FUNCTIONS = [
  { id: "go", label: "Go" },
  { id: "play", label: "Play / Resume" },
  { id: "stop", label: "Stop" },
  { id: "next", label: "Next song" },
  { id: "prev", label: "Previous song" },
  { id: "exitLoop", label: "Exit loop" },
  { id: "panic", label: "Panic" },
];

const STORAGE_KEY = "sp-midi-map";

/**
 * Turn a raw MIDI message into a stable signature + whether it's a "press".
 * trigger is true only on a press (note-on, CC >= 64, or a program change) so a
 * release doesn't fire the function a second time.
 * @param {Uint8Array|number[]} data
 */
export function midiParse(data) {
  const [status, d1, d2] = data;
  const type = status & 0xf0;
  const ch = status & 0x0f;
  if (type === 0x90 && d2 > 0) return { sig: `N:${ch}.${d1}`, trigger: true };
  if (type === 0xb0) return { sig: `C:${ch}.${d1}`, trigger: d2 >= 64 };
  if (type === 0xc0) return { sig: `P:${ch}.${d1}`, trigger: true };
  return null;
}

/** Human label for a stored signature (e.g. "Note 60 · ch 1"). */
export function sigLabel(sig) {
  if (!sig) return "—";
  const [kind, rest] = sig.split(":");
  const [ch, num] = rest.split(".");
  const c = Number(ch) + 1;
  return { N: `Note ${num} · ch ${c}`, C: `CC ${num} · ch ${c}`, P: `PC ${num} · ch ${c}` }[kind] || sig;
}

/** Load the { functionId: signature } map from localStorage. */
export function loadMidiMap() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

/** Persist the map. Writing here fires a "storage" event in the other window. */
export function saveMidiMap(map) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export const MIDI_MAP_KEY = STORAGE_KEY;
