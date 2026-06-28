// SetPilot's Ableton adapter: speaks the OSC API and exposes intent-level methods
// (getSongs, play, stop, ...). The engine talks to THIS, never to raw OSC, so
// another DAW adapter could slot in behind the same shape later.

import { OscClient } from "./osc-client.js";
import { parseCuePoints, deriveSongs } from "../core/songs.js";

export class AbletonAdapter {
  /** @param {{host?:string, remotePort?:number, localPort?:number}} [opts] */
  constructor(opts = {}) {
    this.osc = new OscClient(opts);
  }

  async connect() {
    await this.osc.open();
  }

  /** Tear down and reopen the UDP socket — recovers a wedged socket (e.g. after
   *  the machine sleeps/wakes and network interfaces change). */
  async reconnect() {
    this.osc.close();
    await this.osc.open();
  }

  /** Verify Live + AbletonOSC are reachable. Throws if AbletonOSC doesn't answer. */
  async ping() {
    const [tempo] = await this.osc.request("/live/song/get/tempo", [], { timeout: 1500 });
    return { ok: true, tempo: Number(tempo) };
  }

  /** Current tempo in BPM. */
  async getTempo() {
    const [tempo] = await this.osc.request("/live/song/get/tempo");
    return Number(tempo);
  }

  /** Read the arrangement locators as derived songs (with lengths). The arrangement
   *  length bounds the final song, which has no following locator. */
  async getSongs() {
    const flat = await this.osc.request("/live/song/get/cue_points", [], { timeout: 3000 });
    let songLength = null;
    try {
      const [len] = await this.osc.request("/live/song/get/song_length");
      songLength = Number(len);
    } catch {
      // optional — without it the last song just falls back to no length
    }
    return deriveSongs(parseCuePoints(flat), songLength);
  }

  /** Current playhead position, in beats. */
  async getCurrentBeat() {
    const [beats] = await this.osc.request("/live/song/get/current_song_time");
    return Number(beats);
  }

  /** Move Live's playback position to a cue point (locator) by its index. Unlike
   *  setPosition, this is honoured while stopped — it sets where playback resumes,
   *  so a following continue() starts at the locator instead of the start marker. */
  jumpToCue(index) {
    // cue_point/jump matches int vs str; send an explicit int so it indexes.
    this.osc.send("/live/song/cue_point/jump", { type: "i", value: index });
  }

  // --- Transport --------------------------------------------------------------

  play() {
    this.osc.send("/live/song/start_playing");
  }

  /** Resume from the current position (vs play, which respects start markers). */
  continue() {
    this.osc.send("/live/song/continue_playing");
  }

  stop() {
    this.osc.send("/live/song/stop_playing");
  }

  /** Move the playhead to an absolute beat position. */
  setPosition(beats) {
    this.osc.send("/live/song/set/current_song_time", beats);
  }

  /** Hand control back to the Arrangement (clears the "Back to Arrangement"
   *  override). Safe any time; Session playback disconnects tracks otherwise. */
  backToArrangement() {
    this.osc.send("/live/song/set/back_to_arranger", 0);
  }

  // --- Arrangement loop (for holding a vamp on intros/outros) ------------------

  setLoop(enabled) {
    // `loop` is a BOOL property; our socket sends bare numbers as OSC floats and
    // Live ignores `loop = 1.0`, so send an explicit int to engage the bracket.
    this.osc.send("/live/song/set/loop", { type: "i", value: enabled ? 1 : 0 });
  }

  setLoopRegion(startBeats, lengthBeats) {
    // loop_start / loop_length are float properties — bare numbers are fine.
    this.osc.send("/live/song/set/loop_start", startBeats);
    this.osc.send("/live/song/set/loop_length", lengthBeats);
  }
}
