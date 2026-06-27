// SetPilot — MIDI Control settings window.
// Pure configuration UI: it captures a control during "learn" and writes the
// { functionId: signature } map to localStorage. It does NOT fire transport
// actions — the main window owns the runtime and reads the same map (it picks up
// changes via the "storage" event). Both windows are same-origin, so they share
// localStorage.

import { MIDI_FUNCTIONS, midiParse, sigLabel, loadMidiMap, saveMidiMap } from "/midi-core.js";

const $ = (id) => document.getElementById(id);

let midiMap = loadMidiMap();
let learning = null; // functionId being learned, or null
let access = null;

function render() {
  const ul = $("midi-list");
  ul.innerHTML = "";
  for (const fn of MIDI_FUNCTIONS) {
    const isLearning = learning === fn.id;
    const li = document.createElement("li");
    li.className = "midi-row" + (isLearning ? " learning-row" : "");
    li.innerHTML = `
      <span class="midi-fn"></span>
      <span class="midi-sig${isLearning ? " learning" : ""}">${isLearning ? "Press a control…" : sigLabel(midiMap[fn.id])}</span>
      <button class="midi-learn${isLearning ? " active" : ""}">${isLearning ? "Cancel" : "Learn"}</button>
      <button class="midi-clear" title="Clear"${midiMap[fn.id] ? "" : " disabled"}><i class="fa-solid fa-xmark"></i></button>`;
    li.querySelector(".midi-fn").textContent = fn.label;
    li.querySelector(".midi-learn").onclick = () => {
      learning = isLearning ? null : fn.id; // toggle / cancel
      render();
    };
    li.querySelector(".midi-clear").onclick = () => {
      delete midiMap[fn.id];
      saveMidiMap(midiMap);
      render();
    };
    ul.appendChild(li);
  }
}

function onMidi(ev) {
  const parsed = midiParse(ev.data);
  if (!parsed || !parsed.trigger || !learning) return; // only capture during a learn
  // One control maps to one function: clear any prior owner of this signature.
  for (const id of Object.keys(midiMap)) if (midiMap[id] === parsed.sig) delete midiMap[id];
  midiMap[learning] = parsed.sig;
  saveMidiMap(midiMap);
  learning = null;
  render();
}

function setStatus(ok, text) {
  $("midi-lamp").classList.toggle("on", ok);
  $("midi-status").textContent = text;
}

function refreshDevices() {
  const names = access ? [...access.inputs.values()].map((i) => i.name) : [];
  if (names.length) setStatus(true, names.join(", "));
  else setStatus(false, "No MIDI device connected");
}

async function init() {
  render();
  if (!navigator.requestMIDIAccess) {
    setStatus(false, "Web MIDI not available here");
    return;
  }
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch {
    setStatus(false, "MIDI permission denied");
    return;
  }
  const attach = () => {
    for (const input of access.inputs.values()) input.onmidimessage = onMidi;
    refreshDevices();
  };
  access.onstatechange = attach;
  attach();
}

// Reflect changes made from elsewhere (e.g. clearing via the other window).
window.addEventListener("storage", (e) => {
  if (e.key && e.key !== "sp-midi-map") return;
  midiMap = loadMidiMap();
  render();
});

init();
