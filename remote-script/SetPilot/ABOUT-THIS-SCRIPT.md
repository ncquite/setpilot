# About this script

**This is [AbletonOSC](https://github.com/ideoforms/AbletonOSC) by Daniel John
Jones and contributors** — an MIT-licensed MIDI Remote Script that exposes
Ableton Live's API over OSC. SetPilot depends on it to talk to Live.

The **only** change SetPilot makes is the folder name: the script is shipped in
a folder called `SetPilot/` so that it appears as **"SetPilot"** in Live's
*Control Surface* dropdown (Live derives the surface name from the folder name).
The Python source is otherwise unmodified.

Full credit for this script goes to the AbletonOSC project:

- Project: https://github.com/ideoforms/AbletonOSC
- Author: Daniel John Jones and contributors
- License: MIT (see [`LICENSE.md`](LICENSE.md) in this folder)
- Vendored from commit: `0ca68214bd62c9b5cb641ca34006cfd70ba94430`

If you want the upstream script under its original name, or to report a bug in
the OSC layer, please use the AbletonOSC repository above.
