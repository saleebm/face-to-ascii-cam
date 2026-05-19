// ascii.ts — Pixel grid → ASCII art.
// Handles char aspect ratio (monospace chars are ~2x tall as wide).

import type { SegmentationMask } from "./segmenter";

export type RampName = "standard" | "dense" | "blocks" | "binary";

const RAMPS: Record<RampName, string> = {
  // Light → dark. Index 0 = brightest pixel rendered as space.
  standard: " .:-=+*#%@",
  dense: " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: " ░▒▓█",
  binary: " #",
};

// Empirically ~0.5 for most monospace fonts (chars are ~2x tall as wide).
const CHAR_ASPECT = 0.5;

export interface RenderOpts {
  /** Source video element. */
  video: HTMLVideoElement;
  /** Off-screen canvas used to sample the full frame at the ASCII grid resolution. */
  sampler: HTMLCanvasElement;
  /** Person/background mask from the segmenter. */
  mask: SegmentationMask;
  /** Character columns across the frame. */
  cols: number;
  ramp: RampName;
  invert: boolean;
}

export interface AsciiFrame {
  text: string;
  cols: number;
  rows: number;
}

/**
 * Sample the full video frame, then mask out background pixels using the
 * segmentation mask. Output rows are sized so the displayed ASCII matches the
 * video's aspect ratio, corrected for monospace char aspect.
 */
export function frameToAscii(opts: RenderOpts): AsciiFrame | null {
  const { video, sampler, mask, cols, ramp, invert } = opts;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) return null;

  // Each char cell is rendered at cellW × (cellW / CHAR_ASPECT). For the displayed
  // grid to match the video's aspect, sampler pixels must be the inverse of that
  // cell aspect: rows = cols * (vh/vw) * CHAR_ASPECT.
  const rows = Math.max(1, Math.round(cols * (vh / vw) * CHAR_ASPECT));

  sampler.width = cols;
  sampler.height = rows;
  const ctx = sampler.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // Mirror horizontally so the user sees a selfie view.
  ctx.save();
  ctx.translate(cols, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, vw, vh, 0, 0, cols, rows);
  ctx.restore();

  const { data } = ctx.getImageData(0, 0, cols, rows);
  const glyphs = RAMPS[ramp];
  const last = glyphs.length - 1;

  // Mask is aligned to the unmirrored video; output x needs to be flipped
  // before sampling so it aligns with the mirrored video pixels.
  const mw = mask.w;
  const mh = mask.h;
  const mdata = mask.data;

  let out = "";
  let i = 0;
  for (let y = 0; y < rows; y++) {
    const my = Math.min(mh - 1, Math.floor((y * mh) / rows));
    const mrow = my * mw;
    for (let x = 0; x < cols; x++) {
      const mx = Math.min(mw - 1, Math.floor(((cols - 1 - x) * mw) / cols));
      // Selfie segmenter category mask: 0 = person (foreground), non-zero = background.
      if (mdata[mrow + mx] !== 0) {
        out += " ";
      } else {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // Rec. 709 luminance.
        let lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (invert) lum = 1 - lum;
        const idx = Math.round(lum * last);
        out += glyphs[idx];
      }
      i += 4;
    }
    out += "\n";
  }
  return { text: out, cols, rows };
}

/**
 * Render ASCII to a canvas (smoother / animated style).
 * Sizes the canvas to the parent container and draws glyphs at computed cell size.
 */
export function drawAsciiToCanvas(
  canvas: HTMLCanvasElement,
  frame: AsciiFrame,
  color: string,
): void {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement!;
  const W = parent.clientWidth;
  const H = parent.clientHeight;

  // Pick cell size so cols×rows fits within W×H while respecting char aspect.
  // Char box: cellW × cellH where cellH ≈ cellW * 2 (the inverse of our 0.5 sampling).
  const maxCellW_byWidth = W / frame.cols;
  const maxCellW_byHeight = H / frame.rows / 2; // because cellH = 2*cellW
  const cellW = Math.floor(Math.min(maxCellW_byWidth, maxCellW_byHeight));
  const cellH = cellW * 2;
  if (cellW < 2) return;

  const drawW = cellW * frame.cols;
  const drawH = cellH * frame.rows;

  canvas.width = drawW * dpr;
  canvas.height = drawH * dpr;
  canvas.style.width = `${drawW}px`;
  canvas.style.height = `${drawH}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#050807";
  ctx.fillRect(0, 0, drawW, drawH);

  ctx.fillStyle = color;
  ctx.font = `700 ${cellH}px "JetBrains Mono", monospace`;
  ctx.textBaseline = "top";
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;

  const lines = frame.text.split("\n");
  for (let y = 0; y < frame.rows; y++) {
    const line = lines[y] ?? "";
    for (let x = 0; x < frame.cols; x++) {
      const ch = line[x];
      if (!ch || ch === " ") continue;
      ctx.fillText(ch, x * cellW, y * cellH - cellH * 0.15);
    }
  }
}
