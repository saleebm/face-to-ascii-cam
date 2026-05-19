# FACE//ASCII

Live webcam → face detection → ASCII art. Only the face is rendered. Runs entirely in-browser; Bun just serves the bundled frontend.

Example output: [`face-ascii-1779157141651.txt`](./face-ascii-1779157141651.txt).

## Stack

- **Bun 1.3+** — `Bun.serve({ routes })` with HTML imports bundles the TS/CSS automatically. No webpack/vite.
- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`) — `FaceDetector` running in `VIDEO` mode with BlazeFace short-range. All inference in-browser via WASM/GPU.
- **No backend processing** — webcam never leaves the device. Privacy-first per Lesswhelmed.

## Run

```bash
bun install
bun dev    # http://localhost:3000  (--hot reload)
# or
bun start
```

Webcam APIs require `localhost` or HTTPS. `localhost` is fine for dev.

## How the pipeline works

1. `getUserMedia` streams to a hidden `<video>` element.
2. Every detection tick (~30Hz), `FaceDetector.detectForVideo(video, ts)` returns bounding boxes in video-pixel coordinates.
3. Pick the largest face, smooth its box with an EMA to kill jitter.
4. Crop that box (+18% padding) onto a `cols × rows` sampler canvas — the browser handles resampling.
5. Read the ImageData, convert each pixel to Rec. 709 luminance, index into a glyph ramp.
6. Render either as a `<pre>` (selectable text) or onto a canvas with glow.

The character aspect correction (`CHAR_ASPECT = 0.5`) ensures faces aren't vertically stretched — monospace cells are ~2× tall as they are wide.

## Controls

- **MODE** — DOM-TEXT (copy-pasteable) or CANVAS (animated glow).
- **DENSITY** — Character columns across the face. Higher = more detail, more CPU.
- **RAMP** — Glyph palette: standard, dense, blocks (▒▓█), or binary (` #`).
- **INVERT** — Flip light/dark mapping.

## Files

```
server.ts          Bun.serve entrypoint
index.html         HTML route — Bun bundles the <script> tags
src/main.ts        Orchestrator, loop, UI bindings
src/detector.ts    MediaPipe FaceDetector wrapper
src/ascii.ts       Pixel → ASCII conversion + canvas renderer
src/styles.css     CRT terminal aesthetic
```

## Performance notes

- Detection is throttled to 30Hz; rendering uses `requestAnimationFrame`.
- Resampling is done by the browser via `drawImage(...)` — orders of magnitude faster than per-pixel JS scaling.
- The `willReadFrequently: true` hint on the sampler context speeds up `getImageData`.
- For lower-end devices, drop DENSITY to ~60 and pick RAMP `binary` or `blocks`.

## Tweakables

- `SMOOTH_ALPHA` in `main.ts` — higher = snappier, lower = smoother.
- `pad: 0.18` in the render call — how much area around the face to include.
- `detectionIntervalMs` — detection frequency cap.
