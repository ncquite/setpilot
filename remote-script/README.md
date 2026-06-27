# SetPilot Remote Script for Ableton Live

The `SetPilot/` folder here is the MIDI Remote Script that lets SetPilot control
Ableton Live over OSC. **It is [AbletonOSC](https://github.com/ideoforms/AbletonOSC)
by Daniel John Jones and contributors (MIT licensed)** — bundled with SetPilot so
you don't have to install it separately. The only change is the folder name, so
it shows up as **"SetPilot"** in Live. Full credit and details are in
[`SetPilot/ABOUT-THIS-SCRIPT.md`](SetPilot/ABOUT-THIS-SCRIPT.md).

## Install

Copy the `SetPilot/` folder into Ableton's Remote Scripts directory:

- **macOS:** `~/Music/Ableton/User Library/Remote Scripts/`
- **Windows:** `\Users\<you>\Documents\Ableton\User Library\Remote Scripts\`

Then:

1. Restart Ableton Live.
2. **Preferences → Link / Tempo / MIDI → Control Surface**, pick **SetPilot**.
3. Live shows *"AbletonOSC: Listening for OSC on port 11000"* — that's expected
   (it's the underlying script reporting in), and means it's working.

> The SetPilot desktop app can do this copy for you on first run — this folder is
> the source it installs from.
