// detector.ts — Thin wrapper around MediaPipe Tasks Vision FaceDetector.
// API verified against https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector/web_js

import {
  FaceDetector,
  FilesetResolver,
  type Detection,
} from "@mediapipe/tasks-vision";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

let detector: FaceDetector | null = null;

export async function initDetector(): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      // GPU when available; falls back gracefully.
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.5,
    minSuppressionThreshold: 0.3,
  });
}

/**
 * Detect faces in the given video frame.
 * Returns boxes in pixel coordinates of the video element.
 */
export function detectFaces(video: HTMLVideoElement, timestampMs: number): FaceBox[] {
  if (!detector) return [];
  // detectForVideo returns synchronously per MediaPipe Web API.
  const result = detector.detectForVideo(video, timestampMs);
  return (result.detections ?? [])
    .map(toFaceBox)
    .filter((b): b is FaceBox => b !== null);
}

function toFaceBox(d: Detection): FaceBox | null {
  const bb = d.boundingBox;
  if (!bb) return null;
  const score = d.categories?.[0]?.score ?? 0;
  return {
    x: bb.originX,
    y: bb.originY,
    w: bb.width,
    h: bb.height,
    score,
  };
}
