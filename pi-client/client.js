#!/usr/bin/env node
// AHD Radio DJ — Raspberry Pi client (reference implementation)

const { io } = require("socket.io-client");
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const os = require("os");

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

let currentUrl = null;
let currentVolume = 80;

async function play(url)       { currentUrl = url; await mpvCommand(["loadfile", url, "replace"]); }
async function stop()          { currentUrl = null; await mpvCommand(["stop"]); }
async function pause(v)        { await mpvCommand(["set_property", "pause", v]); }
async function setVolume(v)    { const clamped = Math.max(0, Math.min(100, Number(v) || 0)); await mpvCommand(["set_property", "volume", clamped]); }

async function identify() {
  const tone = spawn("mpv", ["--no-video", "--no-terminal", "av://lavfi/sine=f=880:d=1.5"], { stdio: "ignore" });
  await new Promise((resolve) => tone.on("exit", resolve));
  if (currentUrl) await play(currentUrl);
}

// --- announce overlay (separate mpv process, doesn't interrupt main stream) ---
let announceProc = null;
let preDuckVolume = null;
let fadeTimer = null;

async function fadeVolume(from, to, durationMs) {
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
  const steps = 15;
  const stepMs = durationMs / steps;
  const delta = (to - from) / steps;
  let current = from;
  let step = 0;
  return new Promise((resolve) => {
    fadeTimer = setInterval(async () => {
      step++;
      current += delta;
      if (step >= steps) {
        clearInterval(fadeTimer);
        fadeTimer = null;
        await setVolume(Math.round(to));
        resolve();
      } else {
        await setVolume(Math.round(current));
      }
    }, stepMs);
  });
}

async function announceStart(url, vol) {
  if (announceProc && !announceProc.killed) {
    try { announceProc.kill("SIGTERM"); } catch {}
  }
  preDuckVolume = currentVolume;
  const duckTo = Math.max(1, Math.round(preDuckVolume * 0.2));
  await fadeVolume(preDuckVolume, duckTo, 500);
  announceProc = spawn("mpv", [
    "--no-video", "--no-terminal",
    `--volume=${vol}`,
    "--cache=yes", "--cache-secs=2",
    url,
  ], { stdio: "ignore" });
  announceProc.on("exit", () => { announceProc = null; });
}

async function announceStop() {
  if (announceProc && !announceProc.killed) {
    try { announceProc.kill("SIGTERM"); } catch {}
    announceProc = null;
  }
  if (preDuckVolume !== null) {
    const restoreTo = preDuckVolume;
    preDuckVolume = null;
    const duckFrom = Math.max(1, Math.round(restoreTo * 0.2));
    await fadeVolume(duckFrom, restoreTo, 800);
    currentVolume = restoreTo;
  }
}

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
  if (cfg?.streamUrl) {
    play(cfg.streamUrl);
    currentVolume = cfg.volume ?? 80;
    if (!announceProc) setVolume(currentVolume);
  } else stop();
});

socket.on("command", async (cmd) => {
  console.log("[ahd-pi] cmd:", cmd);
  switch (cmd.type) {
    case "play":           await play(cmd.url); break;
    case "stop":           await stop(); break;
    case "pause":          await pause(true); break;
    case "resume":         await pause(false); break;
    case "volume":         currentVolume = cmd.value; if (!announceProc) await setVolume(cmd.value); break;
    case "identify":       await identify(); break;
    case "announce-start": await announceStart(cmd.url, cmd.volume); break;
    case "announce-stop":  await announceStop(); break;
  }
  socket.emit("status", { type: cmd.type, ts: Date.now() });
});
