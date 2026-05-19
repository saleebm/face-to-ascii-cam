// segmenter.ts — Thin wrapper around MediaPipe Tasks Vision ImageSegmenter.
// Selfie segmenter: category 0 = background, category 1 = person.

import {
  ImageSegmenter,
  FilesetResolver,
  type ImageSegmenterResult,
} from "@mediapipe/tasks-vision";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

export interface SegmentationMask {
  /** Per-pixel category index. 0 = background, 1 = person. Length = w*h. */
  data: Uint8Array;
  w: number;
  h: number;
}

let segmenter: ImageSegmenter | null = null;

export async function initSegmenter(): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
}

/**
 * Segment a video frame into person vs. background.
 * Must copy the mask out of the MediaPipe-owned buffer before the callback returns.
 */
export function segmentFrame(
  video: HTMLVideoElement,
  timestampMs: number,
): SegmentationMask | null {
  if (!segmenter) return null;
  let out: SegmentationMask | null = null;
  segmenter.segmentForVideo(video, timestampMs, (res: ImageSegmenterResult) => {
    const cat = res.categoryMask;
    if (!cat) return;
    const w = cat.width;
    const h = cat.height;
    const src = cat.getAsUint8Array();
    out = { data: new Uint8Array(src), w, h };
    cat.close();
  });
  return out;
}
