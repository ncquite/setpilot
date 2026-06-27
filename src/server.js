// SetPilot server — serves the web remote and bridges it to the engine.
// One engine drives Ableton; every connected browser (the app window, phones,
// tablets) is a thin client that renders state snapshots and sends commands over
// WebSocket, so any device on the LAN becomes a remote.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { networkInterfaces } from "node:os";
import { WebSocketServer } from "ws";

import { APP_NAME } from "./config.js";
import { AbletonAdapter } from "./ableton/ableton-adapter.js";
import { SetlistEngine } from "./core/engine.js";
import { saveSetlist, loadSetlist, listSetlists, deleteSetlist } from "./core/store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");
const PORT = Number(process.env.PORT) || 4747;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

// --- Ableton + engine -------------------------------------------------------

const adapter = new AbletonAdapter();
const engine = new SetlistEngine(adapter);
let abletonConnected = false;
let remoteEnabled = false; // LAN remote off by default; turned on from the app

// localhost (the Electron app itself) is always allowed; LAN clients only when on.
function isLocal(req) {
  const a = (req.socket && req.socket.remoteAddress) || "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}
function lanUrls() {
  return lanAddresses().map((ip) => `http://${ip}:${PORT}`);
}

adapter.osc.on("error", (e) => console.error("OSC error:", e.message));

const HEARTBEAT_MS = 1500; // how often we ping Live
const MISS_LIMIT = 2; // consecutive missed pings before we call it disconnected
const REOPEN_EVERY = 10; // after this many misses (~15s), reopen the OSC socket

let lastSig = null;
let refreshing = false; // reentrancy guard — never let pings overlap
let missCount = 0; // consecutive failed pings

// A fingerprint of the current locators (+ tempo); changes when songs are
// added, removed, renamed, or moved in Live.
function songSig(songs, tempo) {
  return (
    `${tempo}|` +
    songs
      .map((s) => {
        const secs = (s.sections || [])
          .map((x) => `${x.index}@${x.timeBeats}:${x.name}${x.loop ? "L" : ""}`)
          .join("/");
        const flags = `${s.continueAtEnd ? "C" : ""}${s.loop ? "L" : ""}`;
        return `${s.index}:${s.name}:${s.timeBeats}${flags}[${secs}]`;
      })
      .join(",")
  );
}

// Heartbeat + reconnect watchdog. A slow ping can outlast the interval, so we
// guard against overlap; a couple of misses are tolerated before we declare a
// disconnect (avoids flapping on a single dropped UDP reply).
async function refreshAbleton() {
  if (refreshing) return;
  refreshing = true;
  try {
    const { tempo } = await adapter.ping();
    missCount = 0;

    if (!abletonConnected) {
      abletonConnected = true;
      await engine.load(); // full read when Live (re)appears
      lastSig = songSig(engine.songs, engine.tempo);
      console.log(`🎚  Ableton connected — ${engine.songs.length} song(s).`);
      broadcastConnection();
      return;
    }
    // Connected: detect locators changed on the fly and push the update.
    const songs = await adapter.getSongs();
    const sig = songSig(songs, tempo);
    if (sig !== lastSig) {
      lastSig = sig;
      engine.applySongs(songs, tempo); // preserves the set list; broadcasts state
      console.log(`🔄 Locators updated — ${songs.length} song(s).`);
    }
  } catch {
    missCount++;
    if (abletonConnected && missCount >= MISS_LIMIT) {
      abletonConnected = false;
      lastSig = null;
      engine.onDisconnected(); // don't leave the UI stuck "playing"
      console.log("⚠️  Lost Ableton connection — retrying…");
      broadcastConnection();
    }
    // Sustained failure may mean a wedged socket (sleep/wake, interface change).
    if (missCount % REOPEN_EVERY === 0) {
      try {
        await adapter.reconnect();
        console.log("🔌 Reopened OSC socket.");
      } catch (e) {
        console.error("OSC reopen failed:", e.message);
      }
    }
  } finally {
    refreshing = false;
  }
}

// --- HTTP static server -----------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (!remoteEnabled && !isLocal(req)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("SetPilot remote is off. Turn it on in the app to connect from this device.");
    return;
  }
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  // prevent path traversal
  const filePath = normalize(join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

// --- WebSocket bridge -------------------------------------------------------

const wss = new WebSocketServer({ server });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}
function broadcastConnection() {
  broadcast({ type: "connection", abletonConnected });
}

engine.on("state", (snapshot) => broadcast({ type: "state", snapshot }));

// Throttle progress ticks so we don't flood clients (~10/s is plenty for reels).
let lastTick = 0;
engine.on("tick", ({ beat, endBeat, song }) => {
  const now = Date.now();
  if (now - lastTick < 100) return;
  lastTick = now;
  const span = endBeat - song.timeBeats;
  const progress = span > 0 ? Math.min(1, Math.max(0, (beat - song.timeBeats) / span)) : 0;
  broadcast({ type: "progress", progress, beat });
});

async function handleCommand(ws, msg) {
  const { action, payload } = msg;
  switch (action) {
    case "play": engine.play(); break;
    case "playPos": engine.playPos(payload.pos); break;
    case "playSection": engine.playSection(payload.atBeats); break;
    case "releaseLoop": engine.releaseLoop(); break;
    case "stop": engine.stop(); break;
    case "pause": await engine.pause(); break;
    case "resume": engine.resume(); break;
    case "next": engine.goNext(); break;
    case "prev": engine.goPrev(); break;
    case "panic": engine.panic(); break;
    case "setOrder": engine.setOrder(payload.cueIndices); break;
    case "reload":
      if (abletonConnected) {
        await engine.load();
        lastSig = songSig(engine.songs, engine.tempo);
      }
      break;
    case "save":
      await saveSetlist(payload.name, engine.setlist);
      ws.send(JSON.stringify({ type: "setlists", names: await listSetlists() }));
      break;
    case "load": {
      const { resolved, missing } = await loadSetlist(payload.name, engine.songs);
      engine.setOrder(resolved.map((s) => s.index));
      if (missing.length) ws.send(JSON.stringify({ type: "warning", message: `Missing in Live: ${missing.join(", ")}` }));
      break;
    }
    case "deleteSetlist":
      await deleteSetlist(payload.name);
      broadcast({ type: "setlists", names: await listSetlists() });
      break;
    case "listSetlists":
      ws.send(JSON.stringify({ type: "setlists", names: await listSetlists() }));
      break;
    case "setRemote":
      remoteEnabled = Boolean(payload.on);
      if (!remoteEnabled) {
        for (const client of wss.clients) if (client._isLocal === false) client.close();
      }
      broadcast({ type: "remote", enabled: remoteEnabled, lanUrls: lanUrls() });
      console.log(remoteEnabled ? "📡 Remote enabled" : "📴 Remote disabled");
      break;
    default:
      ws.send(JSON.stringify({ type: "error", message: `Unknown action: ${action}` }));
  }
}

wss.on("connection", async (ws, req) => {
  if (!remoteEnabled && !isLocal(req)) {
    ws.close();
    return;
  }
  ws._isLocal = isLocal(req);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; }); // browser auto-pongs at protocol level
  ws.send(JSON.stringify({
    type: "hello",
    abletonConnected,
    remoteEnabled,
    lanUrls: lanUrls(),
    snapshot: engine.snapshot(),
    setlists: await listSetlists(),
  }));
  ws.on("message", async (raw) => {
    try {
      await handleCommand(ws, JSON.parse(raw.toString()));
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: err.message }));
    }
  });
});

// Prune dead client sockets (a tablet that slept or dropped off Wi-Fi). The
// client reconnects on its own; this just stops us broadcasting into the void.
const wsHeartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on("close", () => clearInterval(wsHeartbeat));

// --- Boot -------------------------------------------------------------------

function lanAddresses() {
  const out = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
}

export async function startServer() {
  await adapter.connect();
  await refreshAbleton();
  setInterval(refreshAbleton, HEARTBEAT_MS); // heartbeat + reconnect + locator watchdog

  await new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`\n🎛  ${APP_NAME} is running.\n`);
      console.log(`   This device:  http://localhost:${PORT}`);
      console.log(`   Phone/tablet remote: OFF (turn it on in the app to allow LAN devices)`);
      console.log(`\n   ${abletonConnected ? "✅ Ableton connected" : "⚠️  Waiting for Ableton + AbletonOSC…"}\n`);
      resolve();
    });
  });
  return { port: PORT, url: `http://localhost:${PORT}` };
}

// Run directly with `npm start`, but stay quiet when imported (e.g. by Electron).
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  startServer().catch((err) => {
    console.error("Failed to start:", err.message);
    process.exit(1);
  });
}
