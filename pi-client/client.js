#!/usr/bin/env node
// AHD Radio DJ — Raspberry Pi client (reference implementation)

const { io } = require("socket.io-client");
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER     = process.env.AHD_SERVER || "ws://localhost:3000/ws";
const API_KEY    = process.env.AHD_DEVICE_API_KEY || "";
const IPC_PATH   = "/tmp/ahd-mpv.sock";

// --- device identity ---
function cpuSerial() {
  try {
    const txt = fs.readFileSync("/proc/cpuinfo", "utf8");
    const m = txt.match(/Serial\s*:\s*([0-9a-fA-F]+)/);
    if (m) return m[1];
  } catch { /* not a pi */ }
  return (process.env.AHD_DEVICE_SERIAL || `dev-${os.hostname()}-${process.pid}`);
}

const serial   = cpuSerial();
const hostname = os.hostname();

// --- mpv lifecycle ---
let mpv;
function ensureMpv() {
  if (mpv && !mpv.killed) return;
  try { fs.unlinkSync(IPC_PATH); } catch { /* noop */ }
  mpv = spawn("mpv", [
    "--idle=yes",
    "--no-video",
    "--no-terminal",
    "--volume=80",
    `--input-ipc-server=${IPC_PATH}`,
    "--cache=yes",
    "--cache-secs=2",
    "--audio-client-name=ahd-radio-dj",
  ], { stdio: "ignore" });
  mpv.on("exit", () => { setTimeout(ensureMpv, 1000); });
}

function mpvCommand(cmd) {
  return new Promise((resolve) => {
    const c = net.createConnection(IPC_PATH, () => {
      c.write(JSON.stringify({ command: cmd }) + "\n");
      setTimeout(() => { c.end(); resolve(); }, 50);
    });
    c.on("error", () => resolve());
  });
}

async function play(url)       { await mpvCommand(["loadfile", url, "replace"]); }
async function stop()          { await mpvCommand(["stop"]); }
async function pause(v)        { await mpvCommand(["set_property", "pause", v]); }
async function setVolume(v)    { await mpvCommand(["set_property", "volume", Math.max(0, Math.min(100, v))]); }

// --- connect ---
ensureMpv();

const socket = io(SERVER.replace(/\/ws$/, ""), {
  path: "/ws",
  transports: ["websocket"],
  reconnection: true,
  extraHeaders: {
    Authorization: `Bearer ${API_KEY}`,
    "X-Device-Serial": serial,
    "X-Device-Hostname": hostname,
  },
});

socket.on("connect", () => {
  console.log(`[ahd-pi] connected as ${hostname} (${serial})`);
  setInterval(() => socket.emit("heartbeat"), 30000);
});

socket.on("connect_error", (e) => console.error("[ahd-pi] connect_error:", e.message));
socket.on("disconnect",    (r) => console.warn("[ahd-pi] disconnected:", r));

socket.on("config", (cfg) => {
  console.log("[ahd-pi] config:", cfg);
  if (cfg?.streamUrl) { play(cfg.streamUrl); setVolume(cfg.volume ?? 80); }
  else stop();
});

socket.on("command", async (cmd) => {
  console.log("[ahd-pi] cmd:", cmd);
  switch (cmd.type) {
    case "play":     await play(cmd.url); break;
    case "stop":     await stop(); break;
    case "pause":    await pause(true); break;
    case "resume":   await pause(false); break;
    case "volume":   await setVolume(cmd.value); break;
    case "identify": await play(path.resolve(__dirname, "identify.mp3")); break;
  }
  socket.emit("status", { type: cmd.type, ts: Date.now() });
});
