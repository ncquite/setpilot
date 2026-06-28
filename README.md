# SetPilot 🎛️✈️

**Setlists, supercharged.** A free, gig-ready setlist manager that flies Ableton
Live's Arrangement-view playback for performing bands — a free alternative to
paid Max for Live setlist devices.

You lay out your whole set as one Arrangement with a Locator per song. SetPilot
reads those Locators, lets you reorder them into a performance setlist (without
moving any audio), and triggers / auto-advances playback over OSC. The control
UI runs in the browser, so any phone or tablet on the same network becomes a
remote — no extra paid apps.

## Download

Grab the latest build from the [**Releases**](https://github.com/AshHenbrey/setpilot/releases)
page:

- **macOS** — `SetPilot-<version>-mac-<arch>.dmg` (`arm64` for Apple Silicon,
  `x64` for Intel).
- **Windows** — `SetPilot-<version>-win-x64.exe` (NSIS installer).

These builds are **unsigned** (SetPilot has no paid Developer ID / code-signing
certificate yet), so your OS will warn you the first time:

- **macOS** — right-click the app → **Open** (then **Open** again), or run
  `xattr -dr com.apple.quarantine "/Applications/SetPilot.app"` once.
- **Windows** — on the SmartScreen prompt click **More info → Run anyway**.

## How it talks to Ableton

SetPilot drives Live from outside via a MIDI Remote Script that exposes Live's
API over OSC. That script is [AbletonOSC](https://github.com/ideoforms/AbletonOSC)
by Daniel John Jones and contributors — bundled with SetPilot (in
[`remote-script/`](remote-script/)) so there's nothing extra to download. It's
shipped in a folder named `SetPilot`, so it appears as **"SetPilot"** in Live's
Control Surface list. See [Credits](#credits).

```
Ableton Live  ◄──OSC──►  SetPilot (Node)  ◄──LAN──►  phone / tablet remote
 (SetPilot remote        setlist + timing
  script = AbletonOSC)
```

## Features

- **Reorderable setlist** — drag your songs into any performance order; the audio
  in your Arrangement never moves. Save, load, and export setlists.
- **Song sections** — mark verses/choruses/solos with `>` locators and jump
  between them live (tap, or `[` / `]`).
- **Behaviour set in the file** — flag a song to segue into the next or stop and
  wait; vamp (loop) an intro or outro until you move on. No per-song toggles in
  the app — your Ableton set is the source of truth.
- **Phone / tablet remote** — any device on your network becomes a full remote
  (toggle it on with the Wi-Fi button); no extra apps.
- **MIDI / footswitch control** — learn-to-assign a controller to Go, Stop, Next,
  loop-exit and more (app menu → *Configure MIDI Control*).
- **Keyboard shortcuts** — space (play/pause), ← / → (prev/next), `[` / `]`
  (sections), Esc (stop).
- **Live sync** — locator edits in Ableton appear on every connected device
  instantly.
- **Resilient on stage** — auto-reconnects if Ableton restarts, and keeps
  phone/tablet screens awake during a show.

## Setup

1. Install the bundled remote script: copy [`remote-script/SetPilot/`](remote-script/SetPilot/)
   into Live's Remote Scripts folder, then pick **SetPilot** under Settings →
   Link/Tempo/MIDI → Control Surface. (Step-by-step + paths in
   [`remote-script/README.md`](remote-script/README.md). The desktop app can do
   this copy for you on first run.)
2. Open a Live set in **Arrangement view** with a **Locator at the start of
   each song**.
3. `npm install`
4. Run it:
   - `npm run app` — **standalone SetPilot window** (recommended).
   - `npm start` — server only; open `http://localhost:4747` or the printed
     LAN URL on a phone/tablet.

Both expose the same LAN URL, so the app window and tablet remotes work at once.

## Marking up your set

Everything about how a song behaves lives in the **Locator name in Ableton** —
the show file is the source of truth, there are no per-song toggles in the app.
Name your Locators like this:

| In the Locator name | What it does |
| --- | --- |
| `Sweet Dreams` | A song. |
| `> Verse`, `> Chorus` | A **section** inside the song above it. Tap it in the app (or `[` / `]`) to jump there mid-song. |
| `+CONTINUE` *(or `+SEGUE`)* | At the end of this song, roll straight into the next one. **Default is to stop** and wait for you. |
| `+LOOP` | **Vamp** this song or section — it holds, looping, until you move on. Great for an intro pad or a stretched outro. Tap the pulsing section chip (or Next / another section) to break out and play on. |
| `[nosong]` or a leading `*` | Not a song — hide this Locator from the lists (tuning marks, automation notes, etc.). |

Example: `Outro +LOOP +CONTINUE` vamps the outro until you advance, then segues
into the next song. Flags and `[…]` / `{…}` metadata are stripped from the name
shown in the app.

## Building

Packaging uses [electron-builder](https://www.electron.build/); config lives in the
`build` field of [package.json](package.json), output goes to `dist/`.

```
npm run dist:mac    # macOS .dmg + .zip (arm64 + x64)
npm run dist:win    # Windows NSIS installer (x64)
npm run pack        # quick unpacked build for the current OS (no installer)
```

Notes:
- **App icon** lives in [`build/icon.svg`](build/icon.svg); run `npm run icons` to
  regenerate `icon.icns` / `icon.ico` (needs `rsvg-convert`, ImageMagick, and — on
  macOS — `iconutil`). The bundled `remote-script/` is shipped alongside the app so
  the in-app installer can copy it into Live.
- **macOS builds are unsigned** (no paid Developer ID). First launch: right-click →
  Open, or `xattr -dr com.apple.quarantine "SetPilot.app"`.
- **Building the Windows installer from macOS needs [Wine](https://www.winehq.org/).**
  In practice you don't have to — releases are built in CI (see below).

### Releasing

Releases are cut by [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds on real macOS + Windows runners — no Wine, no local cross-compiling.

1. Bump `version` in [package.json](package.json).
2. Commit, then tag and push:
   ```
   git tag v1.0.1
   git push origin v1.0.1
   ```
3. The workflow builds both platforms and gathers the installers into a
   **draft** GitHub Release. Open it on the
   [Releases](https://github.com/AshHenbrey/setpilot/releases) page, review the
   auto-generated notes, and click **Publish**.

The tag (`v*`) drives it; you can also run it manually from the **Actions** tab
(*Run workflow*). It uses the built-in `GITHUB_TOKEN`, so there are no secrets to
configure.

## Roadmap

- [x] Core engine: setlist model, ordered queue, auto-advance, save/load
- [x] Web remote: set list + songs, reorder, transport, panic
- [x] Live locator auto-sync (add/remove/move on the fly)
- [x] Electron standalone window, auto-reconnect, export set list to text
- [x] Song sections, per-song continue/stop + section looping, non-song markers
- [x] MIDI control — learn-to-assign a footswitch/controller to transport functions
- [x] Packaged builds for macOS (.dmg/.zip) and Windows (NSIS installer)
- [ ] More locator notation: key/notes display, duration override, colours, tags
- [ ] Code signing / notarization for friction-free installs

## Credits

SetPilot's link to Ableton Live is powered by
[**AbletonOSC**](https://github.com/ideoforms/AbletonOSC) by Daniel John Jones
and contributors (MIT licensed). It's bundled in [`remote-script/`](remote-script/),
renamed only so it appears as "SetPilot" in Live — the script itself is their
work. Full attribution is in [THIRD-PARTY.md](THIRD-PARTY.md).

## License

SetPilot is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE)
(AGPL-3.0-or-later). You're free to use, modify, and distribute it — but any
derivative work, **including software made available over a network**, must also
be released as open source under the same license.

The bundled AbletonOSC remote script keeps its own MIT license; see
[THIRD-PARTY.md](THIRD-PARTY.md).
