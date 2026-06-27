# Third-party software

SetPilot bundles and builds on the following open-source projects. We're grateful
to their authors.

## AbletonOSC

- **What:** The MIDI Remote Script that exposes Ableton Live's API over OSC.
  SetPilot's connection to Live is entirely powered by AbletonOSC.
- **Where in this repo:** [`remote-script/SetPilot/`](remote-script/SetPilot/)
  (vendored from commit `0ca68214bd62c9b5cb641ca34006cfd70ba94430`; folder
  renamed to `SetPilot` so it appears as "SetPilot" in Live — source otherwise
  unmodified).
- **Author:** Daniel John Jones and contributors
- **Homepage:** https://github.com/ideoforms/AbletonOSC
- **License:** MIT — see [`remote-script/SetPilot/LICENSE.md`](remote-script/SetPilot/LICENSE.md)

## Runtime / build dependencies

JavaScript dependencies (osc, ws, sortablejs, Electron, Inter & Space Grotesk
fonts, Font Awesome) are declared in [`package.json`](package.json) and carry
their own licenses; see their entries under `node_modules/`.
