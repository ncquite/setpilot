// DAW-agnostic helpers for turning raw cue points into "songs".
//
// In Ableton's Arrangement view a set is one long timeline, and each song is a
// Locator (cue point). A song's natural length is the gap from its locator to
// the NEXT locator on the timeline. The performance order (the setlist) is a
// separate, reorderable sequence — it never moves any audio.
//
// A locator can also mark a SECTION inside a song (verse, chorus, solo) rather
// than a new song: a name prefixed with ">" is a section, anything else starts a
// new song. Sections belong to the song above them and travel with it — they're
// never reordered independently.
//
// Locator names can also carry behaviour, set in the Ableton file itself (so the
// "show" decides how it runs, not a global toggle in the app):
//   +CONTINUE / +SEGUE   when this SONG ends, roll straight into the next
//   +STOP                explicitly stop at the end (the default)
//   +LOOP                vamp this SONG/SECTION until you advance manually
//   [nosong]  or  *…     not a song at all — hide it from the lists
// Flags and [..]/{} metadata are stripped from the displayed name.

/**
 * @typedef {Object} CuePoint
 * @property {number} index   Position in Ableton's cue-point list (used to jump).
 * @property {string} name    Locator name (often encodes key/notes by convention).
 * @property {number} timeBeats  Position on the arrangement timeline, in beats.
 */

/**
 * @typedef {Object} Section
 * @property {number} index   The underlying cue-point index.
 * @property {string} name    Section name, with the ">" prefix and flags stripped.
 * @property {number} timeBeats  Where the section starts on the timeline.
 * @property {number|null} lengthBeats  Gap to the next marker, or song end.
 * @property {boolean} loop   Vamp this section until the operator advances.
 */

/**
 * @typedef {CuePoint & {lengthBeats: number|null, sections: Section[], loop: boolean, continueAtEnd: boolean}} Song
 * lengthBeats is the gap to the next SONG on the timeline, or null for the last.
 * sections lists the markers inside the song (empty for a plain song).
 * loop vamps the whole song (when it has no looping section). continueAtEnd rolls
 * into the next song instead of stopping.
 */

/**
 * Parse a locator name into its kind (song / section / excluded), clean display
 * label, and behaviour flags. Recognised flags and [..]/{} metadata are removed
 * from the label; an unrecognised "+FLAG" is also stripped so names stay tidy.
 * @param {string} rawName
 * @returns {{kind:"song"|"section"|"excluded", label?:string, loop?:boolean, continueAtEnd?:boolean|undefined}}
 */
function parseLocator(rawName) {
  let s = String(rawName).trim();

  // "*" prefix = a note to self, never a song.
  if (s.startsWith("*")) return { kind: "excluded" };

  // Pull out [..] metadata (colours, durations, [nosong]) and {..} descriptions.
  let excluded = false;
  s = s.replace(/\[([^\]]*)\]/g, (_, inner) => {
    if (inner.trim().toLowerCase() === "nosong") excluded = true;
    return " ";
  });
  s = s.replace(/\{[^}]*\}/g, " ");
  if (excluded) return { kind: "excluded" };

  // Pull out +FLAGS (with an optional ":count" we don't use yet).
  const flags = new Set();
  s = s.replace(/\+([A-Za-z]+)(?::\d+)?/g, (_, f) => {
    flags.add(f.toUpperCase());
    return " ";
  });

  // What's left is the name; a leading ">" makes it a section.
  s = s.replace(/\s+/g, " ").trim();
  let kind = "song";
  if (s.startsWith(">")) {
    kind = "section";
    s = s.replace(/^>+\s*/, "");
  }

  let continueAtEnd;
  if (flags.has("CONTINUE") || flags.has("SEGUE")) continueAtEnd = true;
  else if (flags.has("STOP")) continueAtEnd = false;

  return { kind, label: s, loop: flags.has("LOOP"), continueAtEnd };
}

/**
 * Parse AbletonOSC's flat [name, time, name, time, ...] reply into cue points.
 * @param {any[]} flat
 * @returns {CuePoint[]}
 */
export function parseCuePoints(flat) {
  const cues = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    cues.push({
      index: cues.length,
      name: String(flat[i]),
      timeBeats: Number(flat[i + 1]),
    });
  }
  return cues;
}

/**
 * Group cues into songs (with their sections) and derive lengths from the
 * spacing to the next marker on the timeline. A song's length spans all of its
 * sections (gap to the next SONG); a section's length is the gap to the next
 * marker — section or song end. Preserves each cue's original index for jumping.
 *
 * Sections appearing before any song-start are promoted to plain songs, so no
 * locator is ever silently dropped. Excluded locators ([nosong] / "*") are
 * filtered out entirely — they list nothing and don't bound any length.
 * @param {CuePoint[]} cues
 * @returns {Song[]}
 */
export function deriveSongs(cues) {
  const byTime = [...cues].sort((a, b) => a.timeBeats - b.timeBeats);
  const songs = [];
  let current = null;

  for (const cue of byTime) {
    const c = parseLocator(cue.name);
    if (c.kind === "excluded") continue;
    if (c.kind === "section" && current) {
      current.sections.push({
        index: cue.index,
        name: c.label || "Section",
        timeBeats: cue.timeBeats,
        lengthBeats: null,
        loop: c.loop,
      });
    } else {
      current = {
        index: cue.index,
        name: c.label || cue.name,
        timeBeats: cue.timeBeats,
        lengthBeats: null,
        sections: [],
        loop: c.loop,
        continueAtEnd: c.continueAtEnd === true, // default: stop at end
      };
      songs.push(current);
    }
  }

  // Song length: gap to the next song's start on the timeline.
  for (let i = 0; i < songs.length; i++) {
    const next = songs[i + 1];
    songs[i].lengthBeats = next ? next.timeBeats - songs[i].timeBeats : null;
  }
  // Section length: gap to the next section in the same song, else the song end.
  for (const song of songs) {
    const songEnd = song.lengthBeats != null ? song.timeBeats + song.lengthBeats : null;
    for (let j = 0; j < song.sections.length; j++) {
      const end = song.sections[j + 1] ? song.sections[j + 1].timeBeats : songEnd;
      song.sections[j].lengthBeats = end != null ? end - song.sections[j].timeBeats : null;
    }
  }
  return songs;
}

/**
 * Convert a beat count to seconds. Assumes constant tempo — tempo-automated sets
 * would need per-section handling (a v2 concern), so displayed times are estimates.
 * @param {number|null} beats
 * @param {number} bpm
 * @returns {number|null} seconds
 */
export function beatsToSeconds(beats, bpm) {
  if (beats == null || !bpm) return null;
  return (beats / bpm) * 60;
}
