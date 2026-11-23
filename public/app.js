// SetPilot web remote — thin client.
// Renders engine state snapshots and sends commands over WebSocket. The engine
// (server-side) is the single source of truth; we never keep our own copy of the
// setlist — we mutate by sending a new order and re-render whatever comes back.

import { midiParse, loadMidiMap, MIDI_MAP_KEY } from "/midi-core.js";

const $ = (id) => document.getElementById(id);

let ws;
let snapshot = null;
let currentSetlistName = null;
let abletonConnected = false;
let progress = 0;
let dragging = false; // true while a set-list row is being dragged
let justDragged = false; // brief guard so the drop doesn't also fire a play
let remoteEnabled = false; // LAN remote on/off (off by default)
let lanUrls = []; // URLs other devices can use when remote is on
let lastScrolledPos = -1; // last set-list position we auto-scrolled into view
let lastSongKey = null; // cue index of the song progress is tracking
let lastActiveSec = -1; // last highlighted section, so we only re-scroll on change

// ---- WebSocket ----
function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => {
    setLamp(false, "Reconnecting…");
    setTimeout(connect, 1000);
  };
}
function send(action, payload = {}) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ action, payload }));
}

function handle(msg) {
  switch (msg.type) {
    case "hello":
      abletonConnected = msg.abletonConnected;
      remoteEnabled = msg.remoteEnabled;
      lanUrls = msg.lanUrls || [];
      snapshot = msg.snapshot;
      fillSetlists(msg.setlists);
      render();
      break;
    case "remote":
      remoteEnabled = msg.enabled;
      lanUrls = msg.lanUrls || [];
      renderRemote();
      toast(remoteEnabled ? "Remote on" : "Remote off");
      break;
    case "state": {
      // Reset the glideslope on stop/panic (idle) or when the song changes —
      // but not on pause/resume, which keep the playhead where it is.
      const songKey = msg.snapshot?.current?.index ?? null;
      if (msg.snapshot?.status === "idle" || songKey !== lastSongKey) progress = 0;
      lastSongKey = songKey;
      snapshot = msg.snapshot;
      render();
      break;
    }
    case "progress":
      progress = msg.progress;
      renderProgress();
      break;
    case "connection":
      abletonConnected = msg.abletonConnected;
      render();
      break;
    case "setlists":
      fillSetlists(msg.names);
      break;
    case "setlistSaved":
      currentSetlistName = msg.name;
      fillSetlists(msg.names);
      toast(`Saved “${msg.name}”`);
      break;
    case "setlistLoaded":
      currentSetlistName = msg.name;
      $("load-select").value = msg.name;
      break;
    case "warning":
      toast(msg.message);
      break;
    case "error":
      toast(msg.message, true);
      break;
  }
}

// ---- Rendering ----
function fmt(sec) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function setLamp(on, label) {
  $("link-lamp").classList.toggle("on", on);
  $("link-label").textContent = label;
}

function renderRemote() {
  $("remote-btn").classList.toggle("active", remoteEnabled);
  const bar = $("remote-bar");
  if (remoteEnabled) {
    const url = lanUrls[0];
    bar.innerHTML = url
      ? `<i class="fa-solid fa-mobile-screen-button"></i> Remote on · open <b>${url}</b> on your device`
      : `<i class="fa-solid fa-mobile-screen-button"></i> Remote on · no network found`;
    bar.classList.add("show");
  } else {
    bar.classList.remove("show");
  }
}

function render() {
  if (!snapshot) return;

  setLamp(abletonConnected, abletonConnected ? "Ableton Live" : "No Ableton");
  $("bpm").textContent = snapshot.tempo ? Math.round(snapshot.tempo) : "—";

  // Flash the loop indicators at half the beat rate (one pulse every 2 beats).
  const period = snapshot.tempo ? 120 / snapshot.tempo : 1;
  document.body.style.setProperty("--vamp-period", `${period}s`);

  // Now playing
  const playing = snapshot.status === "playing";
  document.body.classList.toggle("is-playing", playing); // drives the live dot
  document.body.classList.toggle("is-looping", Boolean(snapshot.looping));
  $("now-tag").textContent = snapshot.looping
    ? "Looping"
    : { idle: "Ready", playing: "Now Playing", paused: "Paused" }[snapshot.status] || "Ready";
  $("now-title").textContent = snapshot.current ? snapshot.current.name : "Ready";

  // Up Next → the next song; "End of set" on the final song; reserved-but-hidden
  // when idle (so the card height stays stable either way).
  const upNext = $("up-next");
  const upEyebrow = upNext.querySelector(".eyebrow");
  if (snapshot.next) {
    upEyebrow.textContent = "Up Next";
    $("next-title").textContent = snapshot.next.name;
    upNext.classList.remove("hidden", "end-of-set");
  } else if (snapshot.current) {
    upEyebrow.textContent = "End of set";
    $("next-title").textContent = "";
    upNext.classList.remove("hidden");
    upNext.classList.add("end-of-set");
  } else {
    $("next-title").textContent = "";
    upNext.classList.add("hidden");
    upNext.classList.remove("end-of-set");
  }

  // What happens at the end of this song — set in the Ableton file, not here.
  const end = $("endmode");
  const cur = snapshot.current;
  if (cur && snapshot.next && cur.continueAtEnd) {
    end.hidden = false;
    end.className = "endmode continue";
    end.innerHTML = `<i class="fa-solid fa-forward"></i> Continues`;
  } else if (cur) {
    end.hidden = false;
    end.className = "endmode stop";
    end.innerHTML = `<i class="fa-solid fa-circle-stop"></i> Stops at end`;
  } else {
    end.hidden = true;
  }

  renderSections();
  renderProgress();
  if (!dragging) { renderSetlist(); renderSetlistEdit(); } // don't rebuild mid-drag
  renderLibrary();
  renderRemote();
}

// ---- Sections (markers within the current song) ----
// Build a chip per section; the active one is lit live from the progress value,
// so it stays in sync with the bar without extra messages from the server.
function renderSections() {
  const el = $("sections");
  const secs = snapshot?.sections || [];
  if (!secs.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    lastActiveSec = -1;
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = "";
  secs.forEach((sec, i) => {
    const b = document.createElement("button");
    b.className = "chip" + (sec.loop ? " loops" : "");
    b.dataset.i = i;
    b.innerHTML = sec.loop ? `<i class="fa-solid fa-repeat"></i> ` : "";
    b.appendChild(document.createTextNode(sec.name));
    // Tapping the section that's currently vamping breaks out and plays on;
    // any other tap jumps to that section. We match the server's authoritative
    // loop position (not the throttled progress) so leaving is always reliable.
    b.onclick = () => {
      if (snapshot?.looping && snapshot?.loopAt === sec.atBeats) send("releaseLoop");
      else send("playSection", { atBeats: sec.atBeats });
    };
    el.appendChild(b);
  });
  lastActiveSec = -1;
  updateActiveSection();
}

// Which section the playhead is in: the last one whose start we've passed.
function activeSectionIndex() {
  const secs = snapshot?.sections || [];
  if (!secs.length || !snapshot || snapshot.status === "idle") return -1;
  let idx = -1;
  for (let i = 0; i < secs.length; i++) {
    if (progress >= secs[i].startFrac - 1e-6) idx = i;
    else break;
  }
  return idx;
}

function updateActiveSection() {
  const el = $("sections");
  if (el.classList.contains("hidden")) return;
  const secs = snapshot?.sections || [];
  const active = activeSectionIndex();
  const looping = Boolean(snapshot?.looping);
  el.querySelectorAll(".chip").forEach((c) => {
    const i = Number(c.dataset.i);
    // The vamping chip is the one the server says is looping — not whatever the
    // throttled progress points at, which overshoots at the loop boundary.
    const isVamping = looping && secs[i]?.atBeats === snapshot.loopAt;
    const isActive = i === active || isVamping; // keep the looping chip lit
    c.classList.toggle("active", isActive);
    c.classList.toggle("vamping", isVamping);
    if (isVamping) c.title = "Looping — tap to play on";
    else c.removeAttribute("title");
  });
  if (active !== lastActiveSec) {
    lastActiveSec = active;
    el.querySelector(".chip.active")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }
}

function renderProgress() {
  const len = snapshot?.setlist?.[snapshot.currentPos]?.lengthSeconds ?? null;
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  $("gs-fill").style.width = `${pct}%`;
  updateActiveSection();

  const active = snapshot && snapshot.status !== "idle";
  const remaining = len != null ? Math.max(0, len * (1 - progress)) : null;

  $("elapsed").textContent = fmt(active && len != null ? progress * len : 0);
  $("length").textContent = fmt(len);
  $("remaining").textContent = active && remaining != null ? `${fmt(remaining)} remaining` : "—";

  // Time left in the whole set: rest of the current song + every later song.
  let setLeft = null;
  if (active && snapshot.setlist && snapshot.currentPos >= 0) {
    setLeft = remaining ?? 0;
    for (let i = snapshot.currentPos + 1; i < snapshot.setlist.length; i++) {
      setLeft += snapshot.setlist[i].lengthSeconds ?? 0;
    }
  }
  $("set-remaining").textContent = setLeft != null ? `${fmt(setLeft)} left` : "";
}

// One set-list row. `editable` adds the drag grip and remove button (editor view);
// without it the row is playback-only (tap to play). Either way, tapping plays.
function buildRow(s, pos, editable) {
  const li = document.createElement("li");
  li.className = "row" + (pos === snapshot.currentPos ? " current" : "");
  li.innerHTML = `
    ${editable ? `<span class="grip" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></span>` : ""}
    <span class="num">${pos + 1}</span>
    <span class="name"></span>
    <span class="badges">
      ${s.loops ? `<i class="fa-solid fa-repeat" title="Has a loop"></i>` : ""}
      ${s.continueAtEnd ? `<i class="fa-solid fa-forward" title="Continues into the next song"></i>` : ""}
      ${s.parts ? `<span class="parts" title="${s.parts} section${s.parts > 1 ? "s" : ""}"><i class="fa-solid fa-list-ul"></i>${s.parts}</span>` : ""}
    </span>
    <span class="len">${fmt(s.lengthSeconds)}</span>
    ${editable ? `<button class="ctl rm" title="Remove"><i class="fa-solid fa-xmark"></i></button>` : ""}`;
  li.querySelector(".name").textContent = s.name;
  if (editable) {
    // Editor rows are for arranging only — reorder via the grip, remove via the X.
    li.querySelector(".grip").onclick = (e) => e.stopPropagation();
    li.querySelector(".rm").onclick = (e) => { e.stopPropagation(); removeAt(pos); };
  } else {
    // Playback rows: tap to play (the playback view has no drag, so no guard needed).
    li.onclick = () => send("playPos", { pos });
  }
  return li;
}

// Playback view: tap to play, current song highlighted and kept in view.
function renderSetlist() {
  const ol = $("setlist");
  ol.innerHTML = "";
  const list = snapshot.setlist;
  $("set-total").textContent = `${list.length} • ${fmt(snapshot.totalSeconds)}`;
  list.forEach((s, pos) => ol.appendChild(buildRow(s, pos, false)));

  // Keep the active song visible on long sets — but only when it changes, so we
  // don't fight the user scrolling through the list.
  if (snapshot.currentPos >= 0 && snapshot.currentPos !== lastScrolledPos) {
    lastScrolledPos = snapshot.currentPos;
    ol.querySelector(".row.current")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// Editor view: draggable rows with remove buttons.
function renderSetlistEdit() {
  const ol = $("setlist-edit");
  ol.innerHTML = "";
  const list = snapshot.setlist;
  $("edit-total").textContent = `${list.length} • ${fmt(snapshot.totalSeconds)}`;
  list.forEach((s, pos) => ol.appendChild(buildRow(s, pos, true)));
}

function renderLibrary() {
  const ul = $("library");
  ul.innerHTML = "";
  const term = $("search").value.trim().toLowerCase();
  const inPlan = new Set(snapshot.setlist.map((s) => s.index));
  const songs = snapshot.songs.filter((s) => s.name.toLowerCase().includes(term));
  $("full-count").textContent = `${snapshot.songs.length}`;

  songs.forEach((s) => {
    const li = document.createElement("li");
    li.className = "row" + (inPlan.has(s.index) ? " in-plan" : "");
    li.innerHTML = `
      <span class="name"></span>
      <button class="ctl add" title="Add to set list"><i class="fa-solid fa-plus"></i></button>`;
    li.querySelector(".name").textContent = s.name;
    li.querySelector(".add").onclick = () => add(s.index);
    li.querySelector(".name").onclick = () => add(s.index);
    ul.appendChild(li);
  });
}

// ---- Set list editing (always send a fresh order; engine echoes it back) ----
function currentOrder() {
  return snapshot.setlist.map((s) => s.index);
}
function removeAt(pos) {
  const order = currentOrder();
  order.splice(pos, 1);
  send("setOrder", { cueIndices: order });
}
function add(index) {
  send("setOrder", { cueIndices: [...currentOrder(), index] });
}

// ---- Saved set lists ----
function fillSetlists(names) {
  const sel = $("load-select");
  if (currentSetlistName && !names.includes(currentSetlistName)) currentSetlistName = null;
  sel.replaceChildren(new Option("Load Setlist...", ""), ...names.map((n) => new Option(n, n)));
  sel.value = currentSetlistName || "";
}

// ---- Toast ----
let toastTimer;
function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 3000);
}

// In-app modal (Electron has no window.prompt/confirm). With an input it resolves
// to a trimmed name (or null if cancelled); as a confirm it resolves true/false.
function openModal({ title, message = "", withInput = false, initial = "", okLabel = "OK", danger = false }) {
  return new Promise((resolve) => {
    const m = $("modal");
    const input = $("modal-input");
    const ok = $("modal-ok");
    const msg = $("modal-msg");
    $("modal-title").textContent = title;
    msg.textContent = message;
    msg.hidden = !message;
    input.hidden = !withInput;
    input.value = initial;
    ok.textContent = okLabel;
    ok.classList.toggle("danger", danger);
    ok.classList.toggle("primary", !danger);
    m.classList.add("show");
    if (withInput) setTimeout(() => input.focus(), 30);
    const close = (val) => {
      m.classList.remove("show");
      ok.onclick = $("modal-cancel").onclick = input.onkeydown = m.onclick = null;
      resolve(val);
    };
    const confirm = () => close(withInput ? input.value.trim() || null : true);
    const cancel = () => close(withInput ? null : false);
    ok.onclick = confirm;
    $("modal-cancel").onclick = cancel;
    input.onkeydown = (e) => {
      if (e.key === "Enter") confirm();
      else if (e.key === "Escape") cancel();
    };
    m.onclick = (e) => { if (e.target === m) cancel(); };
  });
}
const askName = (initial = "") =>
  openModal({ title: "Save set list", withInput: true, initial, okLabel: "Save" });
const confirmDelete = (name) =>
  openModal({
    title: "Delete set list?",
    message: `“${name}” will be permanently removed. This can’t be undone.`,
    okLabel: "Delete",
    danger: true,
  });

// ---- Controls ----
$("play").onclick = () => send("play");
$("stop").onclick = () => send("stop");
$("panic").onclick = () => send("panic");
$("exit-loop").onclick = () => send("releaseLoop");
$("remote-btn").onclick = () => send("setRemote", { on: !remoteEnabled });
$("search").oninput = renderLibrary;

async function saveAs() {
  const name = await askName(currentSetlistName || "");
  if (name) {
    send("save", { name });
  }
}
$("save").onclick = () => {
  if (currentSetlistName) send("save", { name: currentSetlistName });
  else return saveAs();
};
$("save-as").onclick = saveAs;
$("load-select").onchange = (e) => {
  if (e.target.value) send("load", { name: e.target.value });
};
$("delete-set").onclick = async () => {
  const name = $("load-select").value;
  if (!name) return toast("Choose a saved set list to delete");
  if (await confirmDelete(name)) {
    send("deleteSetlist", { name });
    toast(`Deleted “${name}”`);
  }
};
// Drag-to-reorder the editable list (editor view) — grip handle only, touch-friendly.
Sortable.create($("setlist-edit"), {
  handle: ".grip",
  animation: 150,
  ghostClass: "row-ghost",
  chosenClass: "row-chosen",
  onStart: () => { dragging = true; },
  onEnd: (evt) => {
    dragging = false;
    justDragged = true;
    setTimeout(() => (justDragged = false), 150); // swallow the post-drop click
    const { oldIndex, newIndex } = evt;
    if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
    const order = currentOrder();
    const [moved] = order.splice(oldIndex, 1);
    order.splice(newIndex, 0, moved);
    send("setOrder", { cueIndices: order });
  },
});

// Editor — slides over the playback view. Editing/reordering/managing saved sets
// all live here, keeping the main view focused on the show.
$("edit-btn").onclick = () => document.body.classList.add("editor-open");
$("editor-close").onclick = () => document.body.classList.remove("editor-open");

// ---- Keep the screen awake during a show (tablets/phones) ----
let wakeLock = null;
async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch {
    // Denied or unsupported (e.g. no user gesture yet) — retried on next visibility/interaction.
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") acquireWakeLock();
});
// Some browsers only grant the lock after a user gesture.
window.addEventListener("pointerdown", () => { if (!wakeLock) acquireWakeLock(); });
acquireWakeLock();

// ---- Keyboard / footswitch shortcuts ----
// Stage footswitches typically send arrows, page up/down, or space.
document.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if ($("modal").classList.contains("show")) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key) {
    case " ": // play / pause toggle, preserving position
      e.preventDefault();
      if (snapshot?.status === "playing") send("pause");
      else if (snapshot?.status === "paused") send("resume");
      else send("play");
      break;
    case "ArrowRight":
    case "PageDown":
      e.preventDefault(); send("next"); break;
    case "ArrowLeft":
    case "PageUp":
      e.preventDefault(); send("prev"); break;
    case "]": // jump to next section within the current song
      e.preventDefault(); jumpSection(1); break;
    case "[": // jump to previous section
      e.preventDefault(); jumpSection(-1); break;
    case "Escape":
      e.preventDefault(); send("stop"); break;
  }
});

// Step to an adjacent section of the current song and play from there.
function jumpSection(dir) {
  const secs = snapshot?.sections || [];
  if (!secs.length) return;
  const cur = activeSectionIndex();
  const target = cur < 0 ? (dir > 0 ? 0 : -1) : cur + dir;
  if (target < 0 || target >= secs.length) return;
  send("playSection", { atBeats: secs[target].atBeats });
}

// ---- MIDI control runtime (desktop app; Web MIDI) ----
// Read the footswitch HERE, in the always-open main window, so it works whether
// or not the settings window is open. Mappings are authored there and shared via
// localStorage (reloaded live on change). No-op where Web MIDI is absent (iOS).
const MIDI_ACTIONS = {
  go: () => {
    if (snapshot?.status === "playing") send("next");
    else if (snapshot?.status === "paused") send("resume");
    else send("play");
  },
  play: () => (snapshot?.status === "paused" ? send("resume") : send("play")),
  stop: () => send("stop"),
  next: () => send("next"),
  prev: () => send("prev"),
  exitLoop: () => send("releaseLoop"),
  panic: () => send("panic"),
};

let midiMap = loadMidiMap();
window.addEventListener("storage", (e) => {
  if (e.key === MIDI_MAP_KEY) midiMap = loadMidiMap(); // settings window changed a mapping
});

function onMidiRuntime(ev) {
  const parsed = midiParse(ev.data);
  if (!parsed || !parsed.trigger) return;
  const fnId = Object.keys(midiMap).find((id) => midiMap[id] === parsed.sig);
  MIDI_ACTIONS[fnId]?.();
}

async function initMidi() {
  if (!navigator.requestMIDIAccess) return; // not the desktop app / unsupported
  let access;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch {
    return; // permission denied
  }
  const attach = () => {
    for (const input of access.inputs.values()) input.onmidimessage = onMidiRuntime;
  };
  access.onstatechange = attach;
  attach();
}
initMidi();

connect();
