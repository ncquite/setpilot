// SetPilot core engine — the DAW-agnostic brain.
// Holds the setlist (a reorderable order, decoupled from the arrangement
// timeline), runs the playhead watcher, and exposes transport intent. Talks only
// to an adapter, and emits "state" snapshots a UI can render verbatim.

import { EventEmitter } from "node:events";
import { beatsToSeconds } from "./songs.js";

const TICK_MS = 25; // playhead poll interval for end-detection

export class SetlistEngine extends EventEmitter {
  /** @param {import("../ableton/ableton-adapter.js").AbletonAdapter} adapter */
  constructor(adapter) {
    super();
    this.adapter = adapter;
    /** @type {import("./songs.js").Song[]} */
    this.songs = []; // every song in the Live set, by cue index
    /** @type {import("./songs.js").Song[]} */
    this.setlist = []; // performance order (subset/reorder of songs)
    this.currentPos = -1; // index into setlist, -1 = nothing cued
    this.status = "idle"; // idle | playing | paused
    this.tempo = 120;
    this._watch = null;
    this._pausedBeat = null;
    this._playTimer = null;
    this._loopBeat = null; // start beat of the section/song currently vamping, or null
  }

  /** Pull songs + tempo from the DAW and reset the setlist to timeline order. */
  async load() {
    const tempo = await this.adapter.getTempo();
    const songs = await this.adapter.getSongs();
    this.setlist = []; // explicit (re)load → default order
    this.currentPos = -1;
    this.status = "idle";
    this.applySongs(songs, tempo);
    return this.songs;
  }

  /**
   * Refresh the available songs without disturbing the set list (locators changed
   * in Live). The set list is remapped by song NAME, so order survives and only
   * deleted songs drop out; new locators just appear under SONGS.
   * @param {import("./songs.js").Song[]} songs
   * @param {number} [tempo]
   */
  applySongs(songs, tempo) {
    if (tempo != null) this.tempo = tempo;
    const currentName = this.current?.name ?? null;
    const byName = new Map(songs.map((s) => [s.name, s]));
    this.songs = songs;
    if (this.setlist.length === 0) {
      this.setlist = [...songs].sort((a, b) => a.timeBeats - b.timeBeats);
    } else {
      this.setlist = this.setlist.map((s) => byName.get(s.name)).filter(Boolean);
    }
    if (currentName) this.currentPos = this.setlist.findIndex((s) => s.name === currentName);
    else if (this.currentPos >= this.setlist.length) this.currentPos = -1;
    this._emit();
  }

  /** Set the performance order from an array of cue indices. Unknown indices are skipped. */
  setOrder(cueIndices) {
    const byIndex = new Map(this.songs.map((s) => [s.index, s]));
    this.setlist = cueIndices.map((i) => byIndex.get(i)).filter(Boolean);
    if (this.currentPos >= this.setlist.length) this.currentPos = -1;
    this._emit();
  }

  get current() {
    return this.setlist[this.currentPos] ?? null;
  }
  get next() {
    return this.setlist[this.currentPos + 1] ?? null;
  }

  // --- Transport --------------------------------------------------------------

  /** Cue and play a specific position in the setlist. */
  playPos(pos) {
    if (pos < 0 || pos >= this.setlist.length) return;
    clearTimeout(this._playTimer);
    this._clearLoop(); // drop any vamp before relocating
    const beats = this.setlist[pos].timeBeats;
    const wasPlaying = this.status === "playing";
    this.currentPos = pos;
    this._pausedBeat = null;

    // While rolling, setPosition relocates cleanly either direction. From
    // stopped, start_playing always jumps to bar 1, so we roll first then drop
    // onto the locator. (Both verified against Ableton.)
    if (wasPlaying) {
      this.adapter.setPosition(beats);
    } else {
      this.adapter.play();
      this._playTimer = setTimeout(() => this.adapter.setPosition(beats), 35);
    }

    this.status = "playing";
    this._emit();
    this._startWatch();
  }

  /** Start from the top, or resume the cued position. */
  play() {
    this.playPos(this.currentPos < 0 ? 0 : this.currentPos);
  }

  /** Break out of a vamp without relocating — drop the loop and play on. The
   *  watcher only arms on a region change, so it won't immediately re-arm. */
  releaseLoop() {
    if (this._loopBeat == null) return;
    this._clearLoop();
    this._emit();
  }

  /**
   * Jump the playhead to a beat WITHIN the current song (a section marker),
   * without changing which song is selected. Keeps playing if we were playing,
   * or starts playing from there. The auto-advance watcher is re-armed against
   * the same song, so the end-of-song behaviour is unchanged.
   */
  playSection(beats) {
    if (this.currentPos < 0) return;
    clearTimeout(this._playTimer);
    this._clearLoop(); // the watcher re-arms the loop if the target section vamps
    const wasPlaying = this.status === "playing";
    this._pausedBeat = null;
    if (wasPlaying) {
      this.adapter.setPosition(beats);
    } else {
      this.adapter.play();
      this._playTimer = setTimeout(() => this.adapter.setPosition(beats), 35);
    }
    this.status = "playing";
    this._emit();
    this._startWatch();
  }

  /** Advance to the next song, or stop at the end of the set. */
  goNext() {
    if (this.next) this.playPos(this.currentPos + 1);
    else this.stop();
  }

  goPrev() {
    this.playPos(this.currentPos > 0 ? this.currentPos - 1 : 0);
  }

  /** Pause where we are. Remembers the beat so resume() picks up exactly there. */
  async pause() {
    if (this.status !== "playing") return;
    this._stopWatch();
    try {
      this._pausedBeat = await this.adapter.getCurrentBeat();
    } catch {
      this._pausedBeat = null;
    }
    this.adapter.stop();
    this.status = "paused";
    this._emit();
  }

  resume() {
    if (this.status !== "paused") return;
    if (this._pausedBeat != null) this.adapter.setPosition(this._pausedBeat);
    this.adapter.continue();
    this.status = "playing";
    this._emit();
    this._startWatch();
  }

  stop() {
    clearTimeout(this._playTimer);
    this._stopWatch();
    this.adapter.stop();
    this.adapter.backToArrangement(); // always leave Live ready to play normally
    this.status = "idle";
    this._pausedBeat = null;
    this._emit();
  }

  /** Hard stop — the on-stage "oh no" button. Stops the transport and hands
   *  control back to the Arrangement so the next PLAY behaves normally. */
  panic() {
    clearTimeout(this._playTimer);
    this._stopWatch();
    this.adapter.stop();
    this.adapter.backToArrangement(); // recover, never hijack
    this.status = "idle";
    this._pausedBeat = null;
    this._emit();
  }

  /** Live vanished (crash/quit/sleep). Stop the watcher and show a stopped state
   *  in the UI — but don't command the dead transport (the OSC would go nowhere).
   *  Selection (currentPos) is kept so a reconnect can pick up where we were. */
  onDisconnected() {
    this._stopWatch();
    clearTimeout(this._playTimer);
    this._pausedBeat = null;
    if (this.status !== "idle") {
      this.status = "idle";
      this._emit();
    }
  }

  // --- Playhead watcher (end-of-song + section looping) -----------------------

  /** The section of `song` the beat is currently inside, or null (intro / none). */
  _activeSectionAt(song, beat) {
    let active = null;
    for (const sec of song.sections) {
      if (beat >= sec.timeBeats - 1e-6) active = sec;
      else break;
    }
    return active;
  }

  /** Arm Live's arrangement-loop bracket over a region (a beat-accurate vamp), or
   *  clear it. Emits state when the vamp turns on/off so the UI can reflect it. */
  _applyLoop(region) {
    const wasLooping = this._loopBeat != null;
    if (region && region.loop && region.lengthBeats != null) {
      this.adapter.setLoopRegion(region.timeBeats, region.lengthBeats);
      this.adapter.setLoop(true);
      this._loopBeat = region.timeBeats;
    } else {
      this._clearLoop();
    }
    if ((this._loopBeat != null) !== wasLooping) this._emit(); // UI shows the vamp
  }

  /** Turn Live's arrangement loop off and forget the vamp. Sent unconditionally
   *  so a stale loop (e.g. left over from a previous run) can't keep wrapping. */
  _clearLoop() {
    this.adapter.setLoop(false);
    this._loopBeat = null;
  }

  _startWatch() {
    this._stopWatch();
    const song = this.current;
    if (!song) return;
    const hasLoop = song.loop || song.sections.some((s) => s.loop);
    const endBeat = song.lengthBeats != null ? song.timeBeats + song.lengthBeats : null;
    if (endBeat == null && !hasLoop) return; // last song, nothing to watch for
    const startBeat = song.timeBeats;
    const token = { cancelled: false };
    this._watch = token;
    // Only arm end-detection once we've seen the playhead inside this song —
    // right after a jump the first reading can be stale and would falsely "end".
    let entered = false;
    let lastRegion = null; // identity of the region we last evaluated for looping
    (async () => {
      while (!token.cancelled) {
        let beat;
        try {
          beat = await this.adapter.getCurrentBeat();
        } catch {
          break; // lost connection; let reconnection logic handle it
        }
        if (token.cancelled) break;

        // Arm/disarm the loop bracket when the active region changes. While a
        // vamp is armed Live holds the playhead inside it, so the song never ends.
        const region = this._activeSectionAt(song, beat) || song;
        if (region.index !== lastRegion) {
          lastRegion = region.index;
          this._applyLoop(region);
        }

        if (endBeat != null) {
          if (beat >= startBeat - 0.5 && beat < endBeat) entered = true;
          this.emit("tick", { beat, endBeat, song });
          if (entered && beat >= endBeat) {
            // The Ableton file decides: continue into the next song, or stop.
            if (song.continueAtEnd && this.next) this.goNext();
            else this.stop();
            return;
          }
        }
        await new Promise((r) => setTimeout(r, TICK_MS));
      }
    })();
  }

  _stopWatch() {
    if (this._watch) {
      this._watch.cancelled = true;
      this._watch = null;
    }
    this._clearLoop();
  }

  // --- State snapshot for the UI ---------------------------------------------

  _emit() {
    this.emit("state", this.snapshot());
  }

  snapshot() {
    const totalBeats = this.setlist.reduce((sum, s) => sum + (s.lengthBeats ?? 0), 0);
    const cur = this.current;
    // Sections of the current song, with a start fraction (0..1) so the UI can
    // light the active one against the same progress value that drives the bar.
    const sections =
      cur && cur.sections?.length
        ? cur.sections.map((sec) => ({
            name: sec.name,
            atBeats: sec.timeBeats,
            startFrac: cur.lengthBeats ? (sec.timeBeats - cur.timeBeats) / cur.lengthBeats : 0,
            lengthSeconds: beatsToSeconds(sec.lengthBeats, this.tempo),
            loop: Boolean(sec.loop),
          }))
        : [];
    return {
      status: this.status,
      looping: this._loopBeat != null,
      loopAt: this._loopBeat, // beat where the active vamp starts (matches a section's atBeats)
      tempo: this.tempo,
      currentPos: this.currentPos,
      current: cur
        ? { index: cur.index, name: cur.name, continueAtEnd: cur.continueAtEnd, loop: cur.loop }
        : null,
      next: this.next ? { index: this.next.index, name: this.next.name } : null,
      sections,
      totalSeconds: beatsToSeconds(totalBeats, this.tempo),
      setlist: this.setlist.map((s) => ({
        index: s.index,
        name: s.name,
        lengthSeconds: beatsToSeconds(s.lengthBeats, this.tempo),
        parts: s.sections?.length ?? 0,
        continueAtEnd: Boolean(s.continueAtEnd),
        loops: Boolean(s.loop) || s.sections.some((x) => x.loop),
      })),
      songs: this.songs.map((s) => ({ index: s.index, name: s.name })),
    };
  }
}
