// main.ts — Orchestrator.

import { initDetector, detectFaces } from "./detector";
import { initSegmenter, segmentFrame, type SegmentationMask } from "./segmenter";
import { frameToAscii, drawAsciiToCanvas, type AsciiFrame, type RampName } from "./ascii";

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const video = $<HTMLVideoElement>("video");
const sampler = $<HTMLCanvasElement>("sampler");
const asciiText = $<HTMLPreElement>("ascii-text");
const asciiCanvas = $<HTMLCanvasElement>("ascii-canvas");
const placeholder = $<HTMLDivElement>("placeholder");
const startBtn = $<HTMLButtonElement>("start");
const statusEl = $<HTMLSpanElement>("status");
const fpsEl = $<HTMLSpanElement>("fps");
const msgEl = $<HTMLSpanElement>("msg");
const modeSel = $<HTMLSelectElement>("mode");
const densityInput = $<HTMLInputElement>("density");
const densityVal = $<HTMLSpanElement>("density-val");
const rampSel = $<HTMLSelectElement>("ramp");
const invertCb = $<HTMLInputElement>("invert");
const snapshotBtn = $<HTMLButtonElement>("snapshot");
const saveTxtBtn = $<HTMLButtonElement>("save-txt");

interface State {
  mode: "dom" | "canvas";
  cols: number;
  ramp: RampName;
  invert: boolean;
  lastMask: SegmentationMask | null;
  lastDetectAt: number;
  lastFaceSeenAt: number;
  detectionIntervalMs: number;
  /** Keep rendering for this long after the last face sighting, to avoid flicker. */
  presenceGraceMs: number;
  frameCount: number;
  lastFpsAt: number;
  running: boolean;
  /** Track last fit params so we only reflow the <pre> when they change. */
  lastFit: { cols: number; rows: number; w: number; h: number } | null;
  /** Most recent rendered frame — used by the snapshot button. */
  lastFrame: AsciiFrame | null;
}

const state: State = {
  mode: "dom",
  cols: 180,
  ramp: "standard",
  invert: false,
  lastMask: null,
  lastDetectAt: 0,
  lastFaceSeenAt: 0,
  // Segmenter + detector at ~30Hz max; render every animation frame.
  detectionIntervalMs: 1000 / 30,
  presenceGraceMs: 400,
  frameCount: 0,
  lastFpsAt: performance.now(),
  running: false,
  lastFit: null,
  lastFrame: null,
};

function setStatus(text: string, kind: "init" | "ok" | "warn" | "err" = "init") {
  statusEl.textContent = text;
  statusEl.dataset.state = kind;
}

function setMsg(text: string) {
  msgEl.textContent = text;
}

// --- UI bindings ---

modeSel.addEventListener("change", () => {
  state.mode = modeSel.value as "dom" | "canvas";
  asciiText.classList.toggle("hidden", state.mode !== "dom");
  asciiCanvas.classList.toggle("hidden", state.mode !== "canvas");
});

densityInput.addEventListener("input", () => {
  state.cols = Number(densityInput.value);
  densityVal.textContent = String(state.cols);
});
densityVal.textContent = densityInput.value;

rampSel.addEventListener("change", () => {
  state.ramp = rampSel.value as RampName;
});

invertCb.addEventListener("change", () => {
  state.invert = invertCb.checked;
});

startBtn.addEventListener("click", boot);
snapshotBtn.addEventListener("click", saveSnapshot);
saveTxtBtn.addEventListener("click", saveTxt);

// --- Boot sequence ---

async function boot() {
  startBtn.disabled = true;
  setStatus("REQUEST CAM", "init");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 1280, height: 720 },
      audio: false,
    });
    video.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("video failed to load"));
    });
    await video.play();
  } catch (err) {
    console.error(err);
    setStatus("CAM DENIED", "err");
    setMsg(err instanceof Error ? err.message : String(err));
    startBtn.disabled = false;
    return;
  }

  setStatus("LOAD MODELS", "init");
  try {
    await Promise.all([initDetector(), initSegmenter()]);
  } catch (err) {
    console.error(err);
    setStatus("MODEL FAIL", "err");
    setMsg(err instanceof Error ? err.message : String(err));
    startBtn.disabled = false;
    return;
  }

  placeholder.classList.add("hidden");
  snapshotBtn.disabled = false;
  saveTxtBtn.disabled = false;
  setStatus("ONLINE", "ok");
  state.running = true;
  requestAnimationFrame(loop);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Render the most recent ASCII frame to an offscreen canvas and trigger a PNG download.
// Reuses drawAsciiToCanvas, which sizes from canvas.parentElement — hence the
// hidden offscreen wrapper.
function saveSnapshot() {
  const frame = state.lastFrame;
  if (!frame) {
    setMsg("NO FRAME");
    return;
  }
  const EXPORT_SIZE = 1600;
  const wrap = document.createElement("div");
  wrap.style.cssText = `position:absolute;left:-99999px;top:0;width:${EXPORT_SIZE}px;height:${EXPORT_SIZE}px;`;
  const off = document.createElement("canvas");
  wrap.appendChild(off);
  document.body.appendChild(wrap);
  try {
    drawAsciiToCanvas(off, frame, "#b8ffb8");
    off.toBlob((blob) => {
      if (!blob) {
        setMsg("SAVE FAIL");
        wrap.remove();
        return;
      }
      triggerDownload(blob, `face-ascii-${Date.now()}.png`);
      wrap.remove();
      setMsg("SAVED");
    }, "image/png");
  } catch (err) {
    console.error("snapshot failed", err);
    setMsg("SAVE FAIL");
    wrap.remove();
  }
}

function saveTxt() {
  const frame = state.lastFrame;
  if (!frame) {
    setMsg("NO FRAME");
    return;
  }
  const blob = new Blob([frame.text], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, `face-ascii-${Date.now()}.txt`);
  setMsg("SAVED");
}

// --- Render loop ---

function loop(now: number) {
  if (!state.running) return;

  // Segmentation + detection at throttled rate
  if (now - state.lastDetectAt >= state.detectionIntervalMs) {
    state.lastDetectAt = now;
    try {
      const mask = segmentFrame(video, now);
      if (mask) state.lastMask = mask;
      const faces = detectFaces(video, now);
      if (faces.length > 0) {
        const best = faces.reduce((a, b) => (a.score >= b.score ? a : b));
        state.lastFaceSeenAt = now;
        setStatus(`FACE ${(best.score * 100).toFixed(0)}%`, "ok");
      } else if (now - state.lastFaceSeenAt > state.presenceGraceMs) {
        setStatus("SCAN", "warn");
      }
    } catch (err) {
      console.error("detect/segment error", err);
    }
  }

  // Gate render on face presence (with grace) so jackets-on-chairs etc. don't
  // produce ghosts when nobody is actually there.
  const present = now - state.lastFaceSeenAt <= state.presenceGraceMs;

  if (present && state.lastMask) {
    const frame = frameToAscii({
      video,
      sampler,
      mask: state.lastMask,
      cols: state.cols,
      ramp: state.ramp,
      invert: state.invert,
    });
    if (frame) {
      state.lastFrame = frame;
      if (state.mode === "dom") {
        fitDomText(frame.cols, frame.rows);
        asciiText.textContent = frame.text;
      } else {
        drawAsciiToCanvas(asciiCanvas, frame, "#b8ffb8");
      }
    }
  } else {
    if (state.mode === "dom") asciiText.textContent = "";
    else {
      const ctx = asciiCanvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#050807";
        ctx.fillRect(0, 0, asciiCanvas.width, asciiCanvas.height);
      }
    }
  }

  // FPS counter
  state.frameCount++;
  if (now - state.lastFpsAt >= 500) {
    const fps = (state.frameCount * 1000) / (now - state.lastFpsAt);
    fpsEl.textContent = `${fps.toFixed(0)} fps`;
    state.frameCount = 0;
    state.lastFpsAt = now;
  }

  requestAnimationFrame(loop);
}

// Dynamically size the DOM <pre> so ASCII fills the stage cleanly.
// Only recomputes when inputs change — avoids reflow on every frame.
function fitDomText(cols: number, rows: number) {
  const parent = asciiText.parentElement!;
  const W = parent.clientWidth;
  const H = parent.clientHeight;
  const fit = state.lastFit;
  if (fit && fit.cols === cols && fit.rows === rows && fit.w === W && fit.h === H) {
    return;
  }
  // Monospace char box ≈ 0.6 width × 1.0 height of font-size (with line-height: 1).
  const sizeByW = W / (cols * 0.6);
  const sizeByH = H / rows;
  const fontSize = Math.max(2, Math.floor(Math.min(sizeByW, sizeByH)));
  asciiText.style.fontSize = `${fontSize}px`;
  state.lastFit = { cols, rows, w: W, h: H };
}

// Invalidate the cached fit on resize so the text reflows.
window.addEventListener("resize", () => {
  state.lastFit = null;
});

// Tidy up on tab close.
window.addEventListener("beforeunload", () => {
  state.running = false;
  const s = video.srcObject as MediaStream | null;
  s?.getTracks().forEach((t) => t.stop());
});
