import http from "http";
import fs from "fs";
import os from "os";
import path from "path";

const PORT = Number(process.env.AGY_GRAVITO_PORT || 47831);
const PARENT_PID = Number(process.env.AGY_PARENT_PID || 0);
const VERSION = "1.6.11";
const STATE_DIR = path.join(os.tmpdir(), "agy-gravito-overlay-v1");
const POS_FILE = path.join(STATE_DIR, "gravito-pos.json");

const WIN_W = 620;
const WIN_H = 480;
const ORB_OFFSET_X = 272;
const ORB_OFFSET_Y = 202;

try {
  fs.mkdirSync(STATE_DIR, { recursive: true });
} catch (e) {}

const electron = globalThis._agyElectron;
if (!electron || !electron.app) {
  process.exit(1);
}

const { app, BrowserWindow, screen, ipcMain } = electron;
app.setPath("userData", path.join(STATE_DIR, "userdata"));

let win = null;
let dragTimer = null;
let dragState = null;
let menuOpen = false;
let sseClients = new Set();
let pendingActions = [];
let lastIdeRawSkin = null;
let lastLocalSkinChange = 0;
let knownAlertIds = new Set();
let dismissedAlertIds = new Set();
let retainedAlertsMap = new Map();
let initializedAlerts = false;

let pos = { x: null, y: null };
let savedSkin = "nebula";
let savedSound = true;
let savedSoundPreset = "cristal";

function normSkinMain(s) {
  if (s === "aurora" || s === "orbi") return "aurora";
  if (s === "solaris" || s === "pixel") return "solaris";
  return "nebula";
}

function normPresetMain(p) {
  if (p === "pulso" || p === "arpa" || p === "zen" || p === "cristal") return p;
  return "cristal";
}

try {
  if (fs.existsSync(POS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(POS_FILE, "utf8"));
    if (typeof saved.x === "number" && typeof saved.y === "number") {
      pos = { x: saved.x, y: saved.y };
    }
    if (saved.skin) {
      savedSkin = normSkinMain(saved.skin);
    }
    if (typeof saved.sound === "boolean") {
      savedSound = saved.sound;
    }
    if (saved.soundPreset) {
      savedSoundPreset = normPresetMain(saved.soundPreset);
    }
  }
} catch (e) {}

let state = {
  active: false,
  desktopMode: true,
  skin: savedSkin,
  sound: savedSound,
  soundPreset: savedSoundPreset,
  mood: "idle",
  runCount: 0,
  alerts: [],
  tabs: [],
  lang: "es",
};

function savePrefs() {
  try {
    fs.writeFileSync(
      POS_FILE,
      JSON.stringify({
        x: pos.x,
        y: pos.y,
        skin: state.skin,
        sound: state.sound,
        soundPreset: state.soundPreset,
      }),
      "utf8"
    );
  } catch (e) {}
}

function getDefaultPos() {
  try {
    const primary = screen.getPrimaryDisplay();
    const wa = primary.workArea;
    return {
      x: wa.x + wa.width - 92,
      y: wa.y + wa.height - 102,
    };
  } catch (e) {
    return { x: 1200, y: 700 };
  }
}

function ensureValidPos() {
  if (typeof pos.x !== "number" || typeof pos.y !== "number") {
    pos = getDefaultPos();
    return;
  }
  try {
    const displays = screen.getAllDisplays();
    const cx = pos.x + 38;
    const cy = pos.y + 38;
    const onAny = displays.some(d => {
      const b = d.bounds;
      return cx >= b.x - 20 && cx <= b.x + b.width + 20 && cy >= b.y - 20 && cy <= b.y + b.height + 20;
    });
    if (!onAny) {
      pos = getDefaultPos();
    }
  } catch (e) {}
}

function computeLayout() {
  ensureValidPos();
  let openLeft = true;
  let openUp = true;
  try {
    const disp = screen.getDisplayNearestPoint({ x: pos.x + 38, y: pos.y + 38 });
    const b = disp.workArea || disp.bounds;
    openLeft = (pos.x - b.x) >= 275;
    openUp = (pos.y + 76 - b.y) >= 220;
  } catch (e) {}

  return {
    openLeft,
    openUp,
    bounds: {
      x: Math.round(pos.x - ORB_OFFSET_X),
      y: Math.round(pos.y - ORB_OFFSET_Y),
      width: WIN_W,
      height: WIN_H,
    },
  };
}

function enforceTopMost() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  try {
    win.setAlwaysOnTop(true, "screen-saver", 1);
    win.moveTop();
  } catch (e) {}
}

function syncWindow(playSoundType = null) {
  if (!win || win.isDestroyed()) return;
  const shouldShow = Boolean(state.active && state.desktopMode);
  if (!shouldShow) {
    if (win.isVisible()) win.hide();
    return;
  }
  const layout = computeLayout();
  try {
    const cur = win.getBounds();
    if (
      cur.x !== layout.bounds.x ||
      cur.y !== layout.bounds.y ||
      cur.width !== layout.bounds.width ||
      cur.height !== layout.bounds.height
    ) {
      win.setBounds(layout.bounds, false);
    }
    if (!win.isVisible()) {
      win.showInactive();
      win.setSkipTaskbar(true);
    }
    enforceTopMost();
    win.webContents.send("gravito:state", {
      state,
      menuOpen,
      openLeft: layout.openLeft,
      openUp: layout.openUp,
      dragging: Boolean(dragTimer),
      playSoundType,
    });
  } catch (e) {}
}

function pushAction(action) {
  const payload = JSON.stringify(action);
  pendingActions.push(action);
  if (pendingActions.length > 30) pendingActions.shift();
  for (const res of Array.from(sseClients)) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

const HTML_CONTENT = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; user-select: none; -webkit-user-select: none; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: transparent !important;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  }
  @keyframes agyGasMorph {
    0% {
      transform: rotate(0deg) scale(1);
      border-radius: 54% 46% 60% 40% / 44% 58% 42% 56%;
    }
    33% {
      transform: rotate(120deg) scale(1.1, 0.92);
      border-radius: 40% 60% 44% 56% / 60% 42% 58% 40%;
    }
    66% {
      transform: rotate(240deg) scale(0.93, 1.09);
      border-radius: 60% 40% 54% 46% / 44% 56% 40% 60%;
    }
    100% {
      transform: rotate(360deg) scale(1);
      border-radius: 54% 46% 60% 40% / 44% 58% 42% 56%;
    }
  }
  @keyframes agyGasMorphRev {
    0% {
      transform: rotate(360deg) scale(1.05, 0.95);
      border-radius: 44% 56% 40% 60% / 58% 42% 60% 40%;
    }
    50% {
      transform: rotate(180deg) scale(0.92, 1.12);
      border-radius: 62% 38% 58% 42% / 40% 60% 42% 58%;
    }
    100% {
      transform: rotate(0deg) scale(1.05, 0.95);
      border-radius: 44% 56% 40% 60% / 58% 42% 60% 40%;
    }
  }
  @keyframes agyGasBreath {
    0%, 100% {
      transform: scale(0.9);
      opacity: 0.9;
      border-radius: 52% 48% 46% 54% / 48% 54% 46% 52%;
    }
    50% {
      transform: scale(1.12);
      opacity: 1;
      border-radius: 46% 54% 54% 46% / 54% 46% 52% 48%;
    }
  }
  @keyframes agyMenuIn {
    0% { opacity: 0; transform: scale(0.94) translateY(3px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes agySpin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @keyframes agyPulseWait {
    0%, 100% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.75); }
    50% { transform: scale(1.2); opacity: 0.9; box-shadow: 0 0 0 5px rgba(245, 158, 11, 0); }
  }

  #root { position: relative; width: 100%; height: 100%; pointer-events: none; }
  .interactive { pointer-events: auto; }

  .orb-wrap {
    position: absolute;
    left: 281px;
    top: 211px;
    width: 58px;
    height: 58px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    z-index: 30;
  }
  .orb-wrap.dragging {
    cursor: grabbing !important;
    transform: scale(1.06);
  }

  .aura-gas-outer {
    position: absolute;
    width: 54px;
    height: 54px;
    filter: blur(8.5px);
    opacity: 0.95;
    animation: agyGasMorph 5.4s linear infinite;
    pointer-events: none;
    transition: background 0.25s ease;
  }
  .orb-wrap:hover .aura-gas-outer {
    opacity: 1;
    filter: blur(10px);
  }

  .aura-gas-mid {
    position: absolute;
    width: 44px;
    height: 44px;
    filter: blur(5.5px);
    opacity: 0.92;
    animation: agyGasMorphRev 3.9s linear infinite;
    pointer-events: none;
    transition: background 0.25s ease;
  }

  .aura-gas-wisp {
    position: absolute;
    width: 36px;
    height: 36px;
    filter: blur(4px);
    opacity: 0.9;
    animation: agyGasMorph 2.9s ease-in-out infinite;
    pointer-events: none;
    transition: background 0.25s ease;
  }

  .aura-gas-inner {
    position: relative;
    width: 24px;
    height: 24px;
    filter: blur(3px);
    animation: agyGasBreath 2.4s ease-in-out infinite;
    pointer-events: none;
    transition: background 0.25s ease, box-shadow 0.25s ease;
  }

  .badge {
    position: absolute;
    top: -1px;
    right: -2px;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    border-radius: 9999px;
    background: linear-gradient(155deg, rgba(11, 17, 30, 0.96), rgba(6, 10, 20, 0.98));
    border: 1.5px solid rgba(255, 255, 255, 0.18);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.78), inset 0 1px 0 rgba(255, 255, 255, 0.12);
    z-index: 35;
    pointer-events: auto;
    transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .badge.badge-single-icon {
    width: 20px;
    padding: 0;
  }
  .badge.badge-pill {
    padding: 0 6.5px;
    height: 21px;
  }
  .badge.badge-multi {
    top: -3px;
    right: -8px;
    height: 22px;
    padding: 0 7px;
    gap: 5.5px;
    border-color: rgba(148, 163, 184, 0.38);
    box-shadow: 0 5px 14px rgba(0, 0, 0, 0.82), 0 0 12px rgba(56, 189, 248, 0.22), 0 0 12px rgba(16, 185, 129, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }
  .badge.badge-run {
    border-color: rgba(56, 189, 248, 0.58);
    box-shadow: 0 3px 11px rgba(0, 0, 0, 0.75), 0 0 10px rgba(56, 189, 248, 0.32);
  }
  .badge.badge-wait {
    border-color: rgba(245, 158, 11, 0.68);
    box-shadow: 0 3px 11px rgba(0, 0, 0, 0.75), 0 0 10px rgba(245, 158, 11, 0.38);
  }
  .badge.badge-done {
    border-color: rgba(16, 185, 129, 0.62);
    box-shadow: 0 3px 11px rgba(0, 0, 0, 0.75), 0 0 10px rgba(16, 185, 129, 0.32);
  }
  .badge-seg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3.5px;
    height: 100%;
  }
  .badge-seg.clearable {
    cursor: pointer;
    border-radius: 9999px;
    transition: transform 0.12s ease, opacity 0.12s ease;
  }
  .badge-seg.clearable:hover {
    transform: scale(1.08);
  }
  .badge-sep {
    width: 1px;
    height: 11px;
    background: rgba(255, 255, 255, 0.18);
    flex-shrink: 0;
  }
  .badge-num {
    font-size: 10.5px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.2px;
    font-variant-numeric: tabular-nums;
  }
  .badge-num.num-run { color: #7dd3fc; text-shadow: 0 0 6px rgba(56, 189, 248, 0.45); }
  .badge-num.num-wait { color: #fde68a; text-shadow: 0 0 6px rgba(245, 158, 11, 0.45); }
  .badge-num.num-done { color: #6ee7b7; text-shadow: 0 0 6px rgba(16, 185, 129, 0.45); }

  .chat-icon-thinking {
    width: 11px;
    height: 11px;
    border-radius: 9999px;
    border: 2px solid rgba(56, 189, 248, 0.28);
    border-top-color: #38bdf8;
    flex-shrink: 0;
    animation: agySpin 0.75s linear infinite;
    box-sizing: border-box;
  }
  .chat-icon-waiting {
    width: 8.5px;
    height: 8.5px;
    border-radius: 9999px;
    background: #f59e0b;
    flex-shrink: 0;
    animation: agyPulseWait 1.25s infinite ease-in-out;
  }
  .chat-icon-done {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    border-radius: 9999px;
    background: rgba(16, 185, 129, 0.24);
    color: #34d399;
    font-size: 9.5px;
    font-weight: 800;
    line-height: 1;
    flex-shrink: 0;
  }

  .stack {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 7px;
    width: 258px;
    z-index: 20;
  }
  .bubble {
    position: relative;
    padding: 10px 12px;
    border-radius: 14px;
    background: linear-gradient(155deg, rgba(15, 23, 42, 0.96), rgba(9, 13, 24, 0.98));
    color: #f1f5f9;
    border: 1px solid rgba(148, 163, 184, 0.28);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.68), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    font-size: 12px;
    line-height: 1.35;
    cursor: pointer;
    animation: agyMenuIn 0.16s ease-out;
    transition: transform 0.14s ease, border-color 0.14s ease;
  }
  .bubble:hover { transform: translateY(-1.5px); }
  .bubble.type-done {
    border-color: rgba(16, 185, 129, 0.68);
    background: linear-gradient(150deg, rgba(6, 78, 59, 0.92), rgba(11, 18, 32, 0.98));
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.68), 0 0 18px rgba(16, 185, 129, 0.2);
  }
  .bubble.type-wait {
    border-color: rgba(245, 158, 11, 0.75);
    background: linear-gradient(150deg, rgba(120, 53, 15, 0.92), rgba(11, 18, 32, 0.98));
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.68), 0 0 18px rgba(245, 158, 11, 0.22);
  }

  /* Chat Tabs Dropdown Menu (matches IDE dropdown) */
  .panel {
    position: absolute;
    width: 265px;
    max-height: 256px;
    padding: 6px;
    border-radius: 8px;
    background: #1e1e2e;
    color: #e2e8f0;
    border: 1px solid rgba(128, 128, 128, 0.28);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.65);
    display: flex;
    flex-direction: column;
    z-index: 25;
    animation: agyMenuIn 0.14s ease-out;
    overflow: hidden;
    font-size: 12px;
  }
  .tab-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 244px;
    overflow-y: auto;
    scrollbar-width: thin;
  }
  .tab-list::-webkit-scrollbar {
    width: 3.5px;
  }
  .tab-list::-webkit-scrollbar-track {
    background: transparent;
  }
  .tab-list::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.32);
    border-radius: 9999px;
  }
  .tab-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: #e2e8f0;
    background: transparent;
    transition: background-color 0.1s ease, color 0.1s ease;
  }
  .tab-row:hover {
    background: rgba(59, 130, 246, 0.24);
    color: #ffffff;
  }
  .tab-row.is-active {
    background: rgba(59, 130, 246, 0.16);
    font-weight: 500;
    border-left: 2px solid #3b82f6;
    color: #ffffff;
  }
  .tab-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-act {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 3px;
    opacity: 0.55;
    flex-shrink: 0;
    font-size: 11px;
    color: #cbd5e1;
  }
  .tab-act:hover {
    opacity: 1 !important;
    background: rgba(255, 255, 255, 0.15);
    color: #ffffff;
  }
  .chat-icon-active {
    width: 8px;
    height: 8px;
    border-radius: 9999px;
    background: #3b82f6;
    flex-shrink: 0;
  }
  .chat-icon-idle {
    width: 8px;
    height: 8px;
    border-radius: 9999px;
    background: rgba(148, 163, 184, 0.35);
    flex-shrink: 0;
  }
</style>
</head>
<body>
<div id="root">
  <div id="stackContainer"></div>
  <div id="menuContainer"></div>
  <div id="avatarBtn" class="orb-wrap interactive mood-idle">
    <div id="gasOuter" class="aura-gas-outer"></div>
    <div id="gasMid" class="aura-gas-mid"></div>
    <div id="gasWisp" class="aura-gas-wisp"></div>
    <div id="gasInner" class="aura-gas-inner"></div>
    <span id="orbBadge" class="badge" style="display:none;"></span>
  </div>
</div>
<script>
  const { ipcRenderer } = require("electron");
  const stackContainer = document.getElementById("stackContainer");
  const menuContainer = document.getElementById("menuContainer");
  const avatarBtn = document.getElementById("avatarBtn");
  const gasOuter = document.getElementById("gasOuter");
  const gasMid = document.getElementById("gasMid");
  const gasWisp = document.getElementById("gasWisp");
  const gasInner = document.getElementById("gasInner");
  const orbBadge = document.getElementById("orbBadge");

  let curData = null;
  let lastIgnore = true;

  function playTone(type, preset) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      const pr = preset || "cristal";
      let notes = [];

      if (pr === "pulso") {
        // Sci-Fi Synth Pulse (triangle + sine)
        notes = type === "wait"
          ? [[698.46, 0, 0.11, "triangle", 0.06], [587.33, 0.12, 0.11, "triangle", 0.06], [698.46, 0.24, 0.18, "triangle", 0.07]]
          : [[587.33, 0, 0.09, "triangle", 0.06], [880, 0.09, 0.1, "triangle", 0.06], [1174.66, 0.19, 0.26, "sine", 0.075]];
      } else if (pr === "arpa") {
        // Celestial Pentatonic Harp Glissando
        notes = type === "wait"
          ? [[329.63, 0, 0.18, "triangle", 0.055], [493.88, 0.07, 0.2, "triangle", 0.055], [659.25, 0.14, 0.28, "sine", 0.06]]
          : [
              [349.23, 0, 0.22, "sine", 0.045],
              [440, 0.055, 0.22, "sine", 0.05],
              [523.25, 0.11, 0.24, "sine", 0.055],
              [659.25, 0.165, 0.28, "sine", 0.06],
              [880, 0.22, 0.38, "sine", 0.065]
            ];
      } else if (pr === "zen") {
        // Tibetan Singing Bowl / Deep Harmonic Aura Chord
        notes = type === "wait"
          ? [[261.63, 0, 0.35, "sine", 0.065], [392.00, 0.14, 0.45, "sine", 0.065]]
          : [
              [392.00, 0, 0.65, "sine", 0.055],
              [587.33, 0.02, 0.62, "sine", 0.045],
              [987.77, 0.04, 0.58, "sine", 0.03]
            ];
      } else {
        // Cristal (Default): Harmonic Bell Chime
        notes = type === "wait"
          ? [[440, 0, 0.14, "sine", 0.06], [659.25, 0.13, 0.24, "sine", 0.065]]
          : [
              [523.25, 0, 0.14, "sine", 0.055],
              [659.25, 0.08, 0.16, "sine", 0.055],
              [783.99, 0.16, 0.2, "sine", 0.06],
              [1046.5, 0.24, 0.34, "sine", 0.05]
            ];
      }

      for (const [freq, start, dur, wave, peak] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = wave || "sine";
        osc.frequency.setValueAtTime(freq, now + start);
        gain.gain.setValueAtTime(0.0008, now + start);
        gain.gain.exponentialRampToValueAtTime(peak || 0.055, now + start + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur + 0.02);
      }
      setTimeout(() => {
        try { ctx.close(); } catch (e) {}
      }, 950);
    } catch (e) {}
  }

  function setIgnore(shouldIgnore) {
    if (shouldIgnore !== lastIgnore) {
      lastIgnore = shouldIgnore;
      ipcRenderer.send("gravito:setIgnoreMouse", shouldIgnore);
    }
  }

  window.addEventListener("mousemove", ev => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const overInteractive = Boolean(el && el.closest && el.closest(".interactive"));
    setIgnore(!overInteractive);
  });

  document.addEventListener("mouseleave", () => {
    setIgnore(true);
  });

  avatarBtn.addEventListener("mousedown", ev => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ipcRenderer.send("gravito:dragStart");
    const onUp = () => {
      window.removeEventListener("mouseup", onUp, true);
      ipcRenderer.send("gravito:dragEnd");
    };
    window.addEventListener("mouseup", onUp, true);
  });

  function normSkin(s) {
    if (s === "aurora" || s === "orbi") return "aurora";
    if (s === "solaris" || s === "pixel") return "solaris";
    return "nebula";
  }

  function normPreset(p) {
    if (p === "pulso" || p === "arpa" || p === "zen" || p === "cristal") return p;
    return "cristal";
  }

  function getPalette(skin, mood, menuOpen) {
    if (!menuOpen && mood === "wait") {
      return {
        c1: "#fef08a",
        c2: "#f59e0b",
        c3: "#ea580c",
        aura: "conic-gradient(from 0deg, rgba(245,158,11,0.95), rgba(234,88,12,0.85), rgba(251,191,36,0.9), rgba(245,158,11,0.95))",
        wisp: "conic-gradient(from 110deg, rgba(254,240,138,0.9), rgba(234,88,12,0.45) 45%, rgba(245,158,11,0.92), rgba(234,88,12,0.45) 90%, rgba(254,240,138,0.9))",
        glow: "rgba(245, 158, 11, 0.9)",
        panelBorder: "rgba(245, 158, 11, 0.42)",
        panelGlow: "rgba(245, 158, 11, 0.18)",
        panelLine: "rgba(253, 224, 71, 0.75)",
      };
    }
    const sk = normSkin(skin);
    if (sk === "aurora") {
      return {
        c1: "#6ee7b7",
        c2: "#06b6d4",
        c3: "#10b981",
        aura: "conic-gradient(from 0deg, rgba(16,185,129,0.95), rgba(6,182,212,0.92), rgba(52,211,153,0.9), rgba(14,165,233,0.88), rgba(16,185,129,0.95))",
        wisp: "conic-gradient(from 120deg, rgba(110,231,183,0.92), rgba(6,182,212,0.35) 42%, rgba(16,185,129,0.92), rgba(6,182,212,0.35) 88%, rgba(110,231,183,0.92))",
        glow: "rgba(16, 185, 129, 0.88)",
        panelBorder: "rgba(52, 211, 153, 0.4)",
        panelGlow: "rgba(16, 185, 129, 0.2)",
        panelLine: "rgba(110, 231, 183, 0.78)",
      };
    }
    if (sk === "solaris") {
      return {
        c1: "#f9a8d4",
        c2: "#ec4899",
        c3: "#f59e0b",
        aura: "conic-gradient(from 0deg, rgba(236,72,153,0.95), rgba(245,158,11,0.9), rgba(244,63,94,0.92), rgba(168,85,247,0.88), rgba(236,72,153,0.95))",
        wisp: "conic-gradient(from 120deg, rgba(251,191,36,0.92), rgba(236,72,153,0.35) 42%, rgba(244,63,94,0.92), rgba(168,85,247,0.35) 88%, rgba(251,191,36,0.92))",
        glow: "rgba(236, 72, 153, 0.88)",
        panelBorder: "rgba(244, 114, 182, 0.42)",
        panelGlow: "rgba(236, 72, 153, 0.2)",
        panelLine: "rgba(249, 168, 212, 0.78)",
      };
    }
    return {
      c1: "#c7d2fe",
      c2: "#818cf8",
      c3: "#6366f1",
      aura: "conic-gradient(from 0deg, rgba(129,140,248,0.92), rgba(56,189,248,0.75), rgba(168,85,247,0.9), rgba(99,102,241,0.88), rgba(129,140,248,0.92))",
      wisp: "conic-gradient(from 120deg, rgba(56,189,248,0.88), rgba(99,102,241,0.35) 42%, rgba(192,132,252,0.9), rgba(99,102,241,0.35) 88%, rgba(56,189,248,0.88))",
      glow: "rgba(129, 140, 248, 0.88)",
      panelBorder: "rgba(129, 140, 248, 0.42)",
      panelGlow: "rgba(99, 102, 241, 0.2)",
      panelLine: "rgba(165, 180, 252, 0.78)",
    };
  }

  function getTexts(lang) {
    const sysLocale = String(Intl.DateTimeFormat().resolvedOptions().locale || lang || "es").toLowerCase();
    return ( String(lang || "").startsWith("es") || sysLocale.startsWith("es") ) ? {
      readyTitle: "¡Ya está OK la tarea!",
      waitTitle: "¡Requiere tu atención!",
      filesReady: "archivos listos",
      fileReady: "archivo listo",
      replyReady: "Respuesta completada",
      go: "Ir a pestaña →",
      tabsHdr: "Pestañas de Chat",
      stWait: "Atención",
      stRun: "Pensando",
      stDone: "Listo",
      stActive: "Activa",
      noTabs: "Abrir Antigravity IDE →",
      dragTip: "Arrastra para mover · Clic para ver pestañas"
    } : {
      readyTitle: "Task is ready!",
      waitTitle: "Needs your input!",
      filesReady: "files ready",
      fileReady: "file ready",
      replyReady: "Response completed",
      go: "Go to tab →",
      tabsHdr: "Chat Tabs",
      stWait: "Attention",
      stRun: "Thinking",
      stDone: "Ready",
      stActive: "Active",
      noTabs: "Open Antigravity IDE →",
      dragTip: "Drag to move · Click to view tabs"
    };
  }

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const SVG_NOTE = '<svg style="width:10px;height:10px;opacity:0.85;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>';
  const SVG_MUTE = '<svg style="width:12px;height:12px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
  const SVG_HIDE = '<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

  let lastStackSig = "";
  let lastMenuSig = "";
  let lastBadgeSig = "";

  function render() {
    if (!curData) return;
    const { state, menuOpen, openLeft, openUp, dragging, playSoundType } = curData;
    const t = getTexts(state.lang);
    const sk = normSkin(state.skin);
    const preset = normPreset(state.soundPreset);
    const alerts = Array.isArray(state.alerts) ? state.alerts : [];
    const waitCount = alerts.filter(a => a && a.type === "wait").length;
    const doneCount = alerts.filter(a => a && a.type === "done").length;
    const runCount = Math.max(0, Number(state.runCount || 0));
    const effectiveMood = waitCount > 0 ? "wait" : doneCount > 0 ? "done" : runCount > 0 ? "run" : "idle";
    const p = getPalette(sk, effectiveMood, menuOpen);

    if (playSoundType && state.sound) {
      playTone(playSoundType, preset);
    }

    avatarBtn.className = "orb-wrap interactive mood-" + effectiveMood + (dragging ? " dragging" : "");
    avatarBtn.title = t.dragTip;

    gasOuter.style.background = p.aura;
    gasMid.style.background = p.wisp;
    gasWisp.style.background = \`radial-gradient(circle at 35% 35%, \${p.c1} 0%, \${p.c2} 58%, \${p.c3} 85%, transparent 100%)\`;
    gasInner.style.background = \`radial-gradient(circle at 42% 40%, rgba(255,255,255,0.92) 0%, \${p.c1} 36%, \${p.c2} 72%, transparent 100%)\`;
    gasInner.style.boxShadow = \`0 0 16px \${p.glow}, 0 0 28px \${p.glow}\`;

    const badgeSig = \`\${waitCount}:\${runCount}:\${doneCount}\`;
    if (badgeSig !== lastBadgeSig) {
      lastBadgeSig = badgeSig;
      const segs = [];
      if (waitCount > 0) segs.push({ type: "wait", count: waitCount });
      if (runCount > 0) segs.push({ type: "run", count: runCount });
      if (doneCount > 0) segs.push({ type: "done", count: doneCount });

      if (segs.length === 0) {
        orbBadge.style.display = "none";
        orbBadge.innerHTML = "";
      } else {
        const isMulti = segs.length > 1;
        const showNumbers = isMulti || segs[0].count > 1;
        const sizeCls = isMulti ? "badge-multi" : showNumbers ? "badge-pill" : "badge-single-icon";
        const toneCls = isMulti ? "" : "badge-" + segs[0].type;
        orbBadge.style.display = "flex";
        orbBadge.className = \`badge interactive \${sizeCls} \${toneCls}\`.trim();

        orbBadge.innerHTML = segs
          .map(s => {
            const iconHtml =
              s.type === "wait"
                ? '<span class="chat-icon-waiting"></span>'
                : s.type === "run"
                ? '<span class="chat-icon-thinking"></span>'
                : '<span class="chat-icon-done">✓</span>';
            const numHtml = showNumbers ? \`<span class="badge-num num-\${s.type}">\${s.count}</span>\` : "";
            const clearAttr = s.type !== "run" ? \`data-clear-type="\${s.type}"\` : "";
            const clearCls = s.type !== "run" ? "clearable" : "";
            return \`<span class="badge-seg \${clearCls}" \${clearAttr}>\${iconHtml}\${numHtml}</span>\`;
          })
          .join('<span class="badge-sep"></span>');

        orbBadge.querySelectorAll("[data-clear-type]").forEach(el => {
          el.addEventListener("mousedown", ev => {
            ev.stopPropagation();
            ipcRenderer.send("gravito:action", {
              type: "clearOneByType",
              alertType: el.getAttribute("data-clear-type"),
            });
          });
        });
      }
    }

    const hPos = openLeft ? "right:349px" : "left:349px";
    const vBase = 211;

    const stackSig = JSON.stringify({ menuOpen, alerts, openLeft, openUp, lang: t.readyTitle });
    if (stackSig !== lastStackSig) {
      lastStackSig = stackSig;
      if (!menuOpen && alerts.length > 0) {
        const vPos = openUp ? \`bottom:\${vBase}px\` : \`top:\${vBase}px\`;
        let sHtml = \`<div class="stack interactive" style="\${hPos};\${vPos};">\`;
        for (const al of alerts) {
          const isW = al.type === "wait";
          const hdrIcon = isW ? '<span class="chat-icon-waiting"></span>' : '<span class="chat-icon-done">✓</span>';
          const hdr = isW ? t.waitTitle : t.readyTitle;
          const sub = isW
            ? \`🛠️ \${escapeHtml(al.detail)}\`
            : al.filesCount > 0
            ? \`📄 \${al.filesCount} \${al.filesCount === 1 ? t.fileReady : t.filesReady}\`
            : \`💬 \${t.replyReady}\`;
          sHtml += \`<div class="bubble type-\${escapeHtml(al.type)}" data-jump="\${escapeHtml(al.tabId)}" data-aid="\${escapeHtml(al.id)}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:3px;">
              <span style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:11px;color:\${isW ? '#fbbf24' : '#34d399'}">\${hdrIcon}<span>\${hdr}</span></span>
              <span class="dismiss-btn" data-dismiss="\${escapeHtml(al.id)}" style="opacity:0.7;padding:0 4px;cursor:pointer;font-size:11px;">✕</span>
            </div>
            <div style="font-weight:600;font-size:12.5px;color:#fff;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">«\${escapeHtml(al.title)}»</div>
            <div style="font-size:11px;opacity:0.88;display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${sub}</span>
              <span style="font-weight:600;color:\${isW ? '#fde68a' : '#6ee7b7'};flex-shrink:0;">\${t.go}</span>
            </div>
          </div>\`;
        }
        sHtml += \`</div>\`;
        stackContainer.innerHTML = sHtml;

        stackContainer.querySelectorAll("[data-dismiss]").forEach(el => {
          el.addEventListener("mousedown", ev => {
            ev.stopPropagation();
            ipcRenderer.send("gravito:action", { type: "dismiss", alertId: el.getAttribute("data-dismiss") });
          });
        });

        stackContainer.querySelectorAll("[data-jump]").forEach(el => {
          el.addEventListener("mousedown", ev => {
            ev.stopPropagation();
            ipcRenderer.send("gravito:action", {
              type: "jump",
              tabId: el.getAttribute("data-jump"),
              alertId: el.getAttribute("data-aid"),
            });
          });
        });
      } else {
        stackContainer.innerHTML = "";
      }
    }

    const rawTabs = Array.isArray(state.tabs) ? state.tabs : [];
    const alertByTab = new Map();
    for (const al of alerts) {
      if (al && al.tabId && !alertByTab.has(al.tabId)) {
        alertByTab.set(al.tabId, al);
      }
    }
    const mergedTabs = rawTabs.length > 0
      ? rawTabs.map(tb => {
          const al = alertByTab.get(tb.tabId);
          const st = al ? al.type : (tb.status || "idle");
          return {
            tabId: tb.tabId,
            title: tb.title || "Chat",
            isActive: Boolean(tb.isActive),
            isPinned: Boolean(tb.isPinned),
            status: st,
            alertId: al ? al.id : "",
          };
        })
      : alerts.map(al => ({
          tabId: al.tabId,
          title: al.title || "Chat",
          isActive: false,
          isPinned: false,
          status: al.type || "done",
          alertId: al.id || "",
        }));

    const menuSig = JSON.stringify({ menuOpen, mergedTabs, openLeft, openUp, lang: t.tabsHdr });
    if (menuSig !== lastMenuSig) {
      lastMenuSig = menuSig;
      if (menuOpen) {
        const vPos = openUp ? \`bottom:\${vBase}px\` : \`top:\${vBase}px\`;
        let rowsHtml = "";
        if (mergedTabs.length === 0) {
          rowsHtml = \`<div class="tab-row is-active" data-focus-ide="1">
            <span class="chat-icon-active"></span>
            <span class="tab-title">\${escapeHtml(t.noTabs)}</span>
          </div>\`;
        } else {
          for (const tb of mergedTabs) {
            const st = tb.status;
            const rowCls = tb.isActive ? "is-active" : "";
            const iconHtml =
              st === "wait"
                ? '<span class="chat-icon-waiting"></span>'
                : st === "run"
                ? '<span class="chat-icon-thinking"></span>'
                : st === "done"
                ? '<span class="chat-icon-done">✓</span>'
                : tb.isActive
                ? '<span class="chat-icon-active"></span>'
                : '<span class="chat-icon-idle"></span>';
            rowsHtml += \`<div class="tab-row \${rowCls}" data-tab-jump="\${escapeHtml(tb.tabId)}" data-tab-aid="\${escapeHtml(tb.alertId)}" title="\${escapeHtml(tb.title)}">
              \${iconHtml}
              <span class="tab-title">\${escapeHtml(tb.title)}</span>
            </div>\`;
          }
        }

        menuContainer.innerHTML = \`<div class="panel interactive" style="\${hPos};\${vPos};">
          <div class="tab-list">
            \${rowsHtml}
          </div>
        </div>\`;

        menuContainer.querySelectorAll("[data-tab-jump]").forEach(el => {
          el.addEventListener("mousedown", ev => {
            ev.stopPropagation();
            ipcRenderer.send("gravito:action", {
              type: "jump",
              tabId: el.getAttribute("data-tab-jump"),
              alertId: el.getAttribute("data-tab-aid") || "",
            });
          });
        });

        menuContainer.querySelectorAll("[data-focus-ide]").forEach(el => {
          el.addEventListener("mousedown", ev => {
            ev.stopPropagation();
            ipcRenderer.send("gravito:action", { type: "focusIde" });
          });
        });
      } else {
        menuContainer.innerHTML = "";
      }
    }
  }

  ipcRenderer.on("gravito:state", (_ev, data) => {
    curData = data;
    render();
  });
</script>
</body>
</html>`;

ipcMain.on("gravito:setIgnoreMouse", (_ev, ignore) => {
  if (!win || win.isDestroyed() || dragTimer) return;
  try {
    win.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  } catch (e) {}
});

ipcMain.on("gravito:dragStart", () => {
  if (dragTimer) clearInterval(dragTimer);
  try {
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(false);
      enforceTopMost();
    }
    const startCur = screen.getCursorScreenPoint();
    dragState = {
      startCurX: startCur.x,
      startCurY: startCur.y,
      startPosX: pos.x,
      startPosY: pos.y,
      moved: false,
    };
    dragTimer = setInterval(() => {
      try {
        const cur = screen.getCursorScreenPoint();
        const dx = cur.x - dragState.startCurX;
        const dy = cur.y - dragState.startCurY;
        if (!dragState.moved && Math.hypot(dx, dy) > 4) {
          dragState.moved = true;
          menuOpen = false;
        }
        if (dragState.moved) {
          pos.x = dragState.startPosX + dx;
          pos.y = dragState.startPosY + dy;
          syncWindow();
        }
      } catch (e) {}
    }, 14);
  } catch (e) {}
});

ipcMain.on("gravito:dragEnd", () => {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  const wasMoved = dragState && dragState.moved;
  dragState = null;
  if (wasMoved) {
    savePrefs();
  } else {
    menuOpen = !menuOpen;
  }
  syncWindow();
});

ipcMain.on("gravito:action", (_ev, act) => {
  if (!act) return;
  if (act.type === "dismiss") {
    if (act.alertId) {
      dismissedAlertIds.add(act.alertId);
      retainedAlertsMap.delete(act.alertId);
    }
    state.alerts = (state.alerts || []).filter(a => a.id !== act.alertId);
    syncWindow();
    pushAction(act);
  } else if (act.type === "clearOneByType") {
    const list = Array.isArray(state.alerts) ? state.alerts : [];
    const target = list.find(a => a && a.type === act.alertType) || list[0];
    if (target) {
      if (target.id) {
        dismissedAlertIds.add(target.id);
        retainedAlertsMap.delete(target.id);
      }
      state.alerts = list.filter(a => a.id !== target.id);
      syncWindow();
      pushAction({ type: "dismiss", alertId: target.id, tabId: target.tabId });
    }
  } else if (act.type === "jump") {
    if (act.alertId) {
      dismissedAlertIds.add(act.alertId);
      retainedAlertsMap.delete(act.alertId);
    }
    for (const a of state.alerts || []) {
      if (a && (a.id === act.alertId || a.tabId === act.tabId)) {
        dismissedAlertIds.add(a.id);
        retainedAlertsMap.delete(a.id);
      }
    }
    state.alerts = (state.alerts || []).filter(a => a.id !== act.alertId && a.tabId !== act.tabId);
    menuOpen = false;
    syncWindow();
    pushAction(act);
  } else if (act.type === "togglePin") {
    if (act.tabId && Array.isArray(state.tabs)) {
      state.tabs = state.tabs.map(tb => (tb.tabId === act.tabId ? { ...tb, isPinned: !tb.isPinned } : tb));
      syncWindow();
      pushAction({ type: "togglePin", tabId: act.tabId });
    }
  } else if (act.type === "closeTab") {
    if (act.tabId) {
      if (Array.isArray(state.tabs)) {
        state.tabs = state.tabs.filter(tb => tb.tabId !== act.tabId);
      }
      for (const a of state.alerts || []) {
        if (a && a.tabId === act.tabId) {
          dismissedAlertIds.add(a.id);
          retainedAlertsMap.delete(a.id);
        }
      }
      state.alerts = (state.alerts || []).filter(a => a.tabId !== act.tabId);
      syncWindow();
      pushAction({ type: "closeTab", tabId: act.tabId });
    }
  } else if (act.type === "setSkin") {
    state.skin = normSkinMain(act.skin);
    lastLocalSkinChange = Date.now();
    savePrefs();
    syncWindow();
    pushAction({ type: "setSkin", skin: state.skin });
  } else if (act.type === "setSoundPreset") {
    state.soundPreset = normPresetMain(act.preset);
    state.sound = true;
    savePrefs();
    syncWindow();
    pushAction({ type: "setSoundPreset", preset: state.soundPreset, sound: true });
  } else if (act.type === "toggleSound") {
    state.sound = !state.sound;
    savePrefs();
    syncWindow(state.sound ? "done" : null);
    pushAction({ type: "setSound", sound: state.sound });
  } else if (act.type === "focusIde") {
    menuOpen = false;
    syncWindow();
    pushAction({ type: "focusIde" });
  } else if (act.type === "hide") {
    menuOpen = false;
    state.active = false;
    syncWindow();
    pushAction({ type: "setActive", active: false });
  }
});

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        pid: process.pid,
        version: VERSION,
        skin: state.skin,
        soundPreset: state.soundPreset,
      })
    );
    return;
  }
  if (req.url === "/quit") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    setTimeout(() => process.exit(0), 50);
    return;
  }
  if (req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("data: {\"type\":\"connected\"}\n\n");
    while (pendingActions.length > 0) {
      const a = pendingActions.shift();
      res.write(`data: ${JSON.stringify(a)}\n\n`);
    }
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (req.url === "/state" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => {
      let newSoundType = null;
      try {
        const next = JSON.parse(body || "{}");
        if (next.resetPos) {
          pos = getDefaultPos();
          savePrefs();
        }
        delete next.resetPos;

        if (next.skin !== undefined) {
          const incomingRaw = String(next.skin);
          if (lastIdeRawSkin === null) {
            lastIdeRawSkin = incomingRaw;
          } else if (incomingRaw !== lastIdeRawSkin && Date.now() - lastLocalSkinChange > 2000) {
            lastIdeRawSkin = incomingRaw;
            state.skin = normSkinMain(incomingRaw);
            savePrefs();
          }
          delete next.skin;
        }
        delete next.sound;
        delete next.soundPreset;

        if (Array.isArray(next.alerts)) {
          const incoming = next.alerts.filter(al => al && al.id && !dismissedAlertIds.has(al.id));
          const incomingIds = new Set(incoming.map(al => al.id));
          const runningIds = new Set(Array.isArray(next.runningTabIds) ? next.runningTabIds : []);

          if (!initializedAlerts) {
            initializedAlerts = true;
            for (const al of incoming) {
              if (al && al.id) {
                knownAlertIds.add(al.id);
                retainedAlertsMap.set(al.id, al);
              }
            }
          } else {
            for (const al of incoming) {
              if (al && al.id && !knownAlertIds.has(al.id)) {
                knownAlertIds.add(al.id);
                if (!newSoundType || al.type === "wait") {
                  newSoundType = al.type === "wait" ? "wait" : "done";
                }
              }
              if (al && al.id) {
                for (const [oldId, oldAl] of Array.from(retainedAlertsMap.entries())) {
                  if (oldId !== al.id && oldAl.tabId && oldAl.tabId === al.tabId) {
                    retainedAlertsMap.delete(oldId);
                  }
                }
                retainedAlertsMap.set(al.id, al);
              }
            }
          }

          for (const [oldId, oldAl] of Array.from(retainedAlertsMap.entries())) {
            if (dismissedAlertIds.has(oldId)) {
              retainedAlertsMap.delete(oldId);
              continue;
            }
            if (oldAl.tabId && runningIds.has(oldAl.tabId)) {
              retainedAlertsMap.delete(oldId);
              continue;
            }
            if (!incomingIds.has(oldId)) {
              if (oldAl.type === "wait" || !oldAl.autoHide) {
                retainedAlertsMap.delete(oldId);
              }
            }
          }

          next.alerts = Array.from(retainedAlertsMap.values()).slice(0, 5);
        }

        state = { ...state, ...next };
        syncWindow(newSoundType);
      } catch (e) {}
      const drained = pendingActions.splice(0, pendingActions.length);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, actions: drained }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.on("error", () => {
  process.exit(0);
});

app.whenReady().then(() => {
  server.listen(PORT, "127.0.0.1", () => {
    const layout = computeLayout();
    win = new BrowserWindow({
      x: layout.bounds.x,
      y: layout.bounds.y,
      width: layout.bounds.width,
      height: layout.bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
      },
    });
    win.setAlwaysOnTop(true, "screen-saver", 1);
    win.setSkipTaskbar(true);
    win.setIgnoreMouseEvents(true, { forward: true });
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch (e) {}

    win.on("blur", () => {
      if (menuOpen && !dragTimer) {
        menuOpen = false;
        syncWindow();
      }
      enforceTopMost();
    });

    setInterval(() => {
      enforceTopMost();
    }, 1500);

    const htmlPath = path.join(STATE_DIR, "gravito-ui.html");
    fs.writeFileSync(htmlPath, HTML_CONTENT, "utf8");
    win.loadFile(htmlPath);
    win.webContents.once("did-finish-load", () => {
      syncWindow();
    });
  });
});

if (PARENT_PID > 0) {
  setInterval(() => {
    try {
      process.kill(PARENT_PID, 0);
    } catch (e) {
      process.exit(0);
    }
  }, 4000);
}
