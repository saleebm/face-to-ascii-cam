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

export interface SourceRect {
  /** Top-left x in unmirrored video pixels. */
  x: number;
  /** Top-left y in unmirrored video pixels. */
  y: number;
  /** Width in unmirrored video pixels. */
  w: number;
  /** Height in unmirrored video pixels. */
  h: number;
}

export interface RenderOpts {
  video: HTMLVideoElement;
  /** Off-screen canvas used to sample the source region at the ASCII grid resolution. */
  sampler: HTMLCanvasElement;
  /** Person/background mask from the segmenter (aligned to full video, unmirrored). */
  mask: SegmentationMask;
  /** Character columns across the sampled region. */
  cols: number;
  ramp: RampName;
  invert: boolean;
  /**
   * Region of the video to render. If omitted, the full frame is sampled.
   * Coordinates are in unmirrored video-pixel space.
   */
  sourceRect?: SourceRect;
}

export interface AsciiFrame {
  text: string;
  cols: number;
  rows: number;
}

/**
 * MediaPipe selfie_segmenter category mask: empirically `0` indexes the
 * foreground (person) class for this model. Centralised so callers don't
 * carry on the historical comment confusion.
 */
function isForeground(maskValue: number): boolean {
  return maskValue === 0;
}

/**
 * Sample the configured region of the video frame, then mask out background
 * pixels using a refined segmentation mask. Output rows are sized so the
 * displayed ASCII matches the sampled region's aspect ratio, corrected for
 * monospace char aspect.
 */
export function frameToAscii(opts: RenderOpts): AsciiFrame | null {
  const { video, sampler, mask, cols, ramp, invert, sourceRect } = opts;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) return null;

  const sx = sourceRect ? sourceRect.x : 0;
  const sy = sourceRect ? sourceRect.y : 0;
  const sw = sourceRect ? sourceRect.w : vw;
  const sh = sourceRect ? sourceRect.h : vh;
  if (sw <= 0 || sh <= 0) return null;

  // Each char cell renders at cellW × (cellW / CHAR_ASPECT). For the displayed
  // grid to match the source region's aspect, sampler pixels must be the
  // inverse of that cell aspect: rows = cols * (sh/sw) * CHAR_ASPECT.
  const rows = Math.max(1, Math.round(cols * (sh / sw) * CHAR_ASPECT));

  sampler.width = cols;
  sampler.height = rows;
  const ctx = sampler.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // Mirror horizontally so the user sees a selfie view.
  ctx.save();
  ctx.translate(cols, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cols, rows);
  ctx.restore();

  const { data } = ctx.getImageData(0, 0, cols, rows);

  // --- Build a cell-resolution foreground bitmap from the mask. ---
  // Mask is aligned to the unmirrored video. The sampler is mirrored, so the
  // mask x for output column x corresponds to the right edge of the cell in
  // unmirrored space.
  const mw = mask.w;
  const mh = mask.h;
  const mdata = mask.data;

  // Mapping helpers: unmirrored video → mask grid.
  const mxScale = mw / vw;
  const myScale = mh / vh;

  const fg = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    // Centre of the cell in source-video y.
    const vy = sy + ((y + 0.5) / rows) * sh;
    const my = Math.min(mh - 1, Math.max(0, Math.floor(vy * myScale)));
    const mrow = my * mw;
    for (let x = 0; x < cols; x++) {
      // x is in mirrored output; flip back to unmirrored source x.
      const vx = sx + ((cols - 0.5 - x) / cols) * sw;
      const mx = Math.min(mw - 1, Math.max(0, Math.floor(vx * mxScale)));
      fg[y * cols + x] = isForeground(mdata[mrow + mx]) ? 1 : 0;
    }
  }

  // --- Refine: one-cell 8-neighborhood dilation. ---
  // Selfie segmenter trims ears/hair by a pixel; a single 1-cell dilation
  // recovers them without pulling in much background. Two passes was too
  // greedy — it sucked in dark background bands around the silhouette that
  // then rendered as dense glyphs.
  const refined = dilate(fg, cols, rows);

  // --- Compose output. ---
  const glyphs = RAMPS[ramp];
  const last = glyphs.length - 1;
  // Cells added by dilation are kept only if they are bright enough to plausibly
  // be face/hair. Anything darker than this threshold (Rec.709, 0..1) reverts
  // to background. Originally-segmented cells are never gated, so dark hair
  // and beards inside the silhouette still render.
  const DILATED_LUM_GATE = 0.12;

  let out = "";
  let i = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      const isFg = refined[idx] === 1;
      if (!isFg) {
        out += " ";
        i += 4;
        continue;
      }
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Rec. 709 luminance (un-inverted, used for the gate).
      const rawLum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      // A cell that the segmenter did NOT mark as foreground only stays if it
      // looks plausibly face/hair. Drops dark background that leaked in.
      if (fg[idx] === 0 && rawLum < DILATED_LUM_GATE) {
        out += " ";
        i += 4;
        continue;
      }
      const lum = invert ? 1 - rawLum : rawLum;
      const gi = Math.round(lum * last);
      out += glyphs[gi];
      i += 4;
    }
    out += "\n";
  }
  return { text: out, cols, rows };
}

/** 1-cell 8-neighborhood dilation. Expands the foreground region by one cell on all sides. */
function dilate(src: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(rows - 1, y + 1);
    for (let x = 0; x < cols; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(cols - 1, x + 1);
      let any = 0;
      outer: for (let yy = y0; yy <= y1; yy++) {
        const row = yy * cols;
        for (let xx = x0; xx <= x1; xx++) {
          if (src[row + xx] === 1) {
            any = 1;
            break outer;
          }
        }
      }
      out[y * cols + x] = any;
    }
  }
  return out;
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
  const maxCellW_byHeight = H / frame.rows / 2;
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
