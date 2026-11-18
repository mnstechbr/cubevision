import type { Cursor } from '../ui';
import { Gestures, handDistance, type HandFrame } from './gestures';
import type { Intents } from './pointer';

/** Live tracker diagnostics, shown with ?debug. */
export const tracker = { text: '' };

export interface HandsSession {
  /** With ?gravar: the landmark numbers seen so far as JSON (no images), or null. */
  recording(): string | null;
  stop(): void;
  pause(): void;
  resume(): void;
}

interface Options {
  video: HTMLVideoElement;
  /** Drawn over the preview: what the tracker sees, so people can tell why it misses. */
  skeleton: HTMLCanvasElement;
  intents: Intents;
  /** Coaching: the hand is too close to or too far from the camera. */
  onDistance(d: 'close' | 'far'): void;
  onCursors(c: Cursor[]): void;
  onProgress(p: number): void;
}

const CAMERA_TIMEOUT = 12_000;
const MODEL_TIMEOUT = 40_000;
// Bytes to show real progress even when the server doesn't send Content-Length.
const ASSETS: [string, number][] = [
  ['/models/hand_landmarker.task', 7_819_105],
  ['/mediapipe/vision_wasm_module_internal.wasm', 14_000_000],
];

function timeout<T>(p: Promise<T>, ms: number, what: string) {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);
}

const openCamera = () =>
  timeout(
    navigator.mediaDevices.getUserMedia({
      // 16:9 at full sensor width: on most webcams 4:3 crops the sides, and both hands must fit.
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 }, facingMode: 'user', frameRate: { ideal: 30 } },
      audio: false,
    }),
    CAMERA_TIMEOUT,
    'camera',
  );

/** Downloads the model (kept) and the WASM (warms the HTTP cache for the worker), with progress. */
async function fetchAssets(onProgress: (p: number) => void) {
  const total = ASSETS.reduce((s, [, n]) => s + n, 0);
  const done = ASSETS.map(() => 0);
  const report = () => onProgress(Math.min(0.99, done.reduce((a, b) => a + b, 0) / total));
  const bodies = await Promise.all(
    ASSETS.map(async ([url], i) => {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        chunks.push(value);
        done[i] += value.byteLength;
        report();
      }
      return new Blob(chunks as BlobPart[]).arrayBuffer();
    }),
  );
  return bodies[0];
}

export async function startHands(o: Options): Promise<HandsSession> {
  let stream = await openCamera();
  let delegate = '?';
  const worker = new Worker(new URL('./hands.worker.ts', import.meta.url), { type: 'module' });
  try {
    const model = await timeout(fetchAssets(o.onProgress), MODEL_TIMEOUT, 'hand model');
    await timeout(
      new Promise<void>((resolve, reject) => {
        worker.onmessage = (e) => {
          if (e.data.type !== 'ready') return reject(new Error(e.data.message));
          delegate = e.data.delegate;
          resolve();
        };
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage({ type: 'init', model }, [model]);
      }),
      MODEL_TIMEOUT,
      'hand tracker',
    );
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    worker.terminate();
    throw e;
  }

  const video = o.video;
  video.srcObject = stream;
  await video.play();
  video.classList.add('on');
  const sk = o.skeleton;
  sk.width = 320;
  sk.height = Math.round((320 * video.videoHeight) / Math.max(1, video.videoWidth));
  sk.classList.add('on');
  const g = sk.getContext('2d')!;
  const aspect = video.videoWidth / Math.max(1, video.videoHeight);
  let lastCoach = 0;

  const gestures = new Gestures(o.intents);
  const stats = { frames: 0, found: 0, since: performance.now() };
  // Calibration aid: only numbers (21 points per hand), capped at ~3 min, never sent anywhere.
  const rec = new URLSearchParams(location.search).has('gravar') ? ([] as { t: number; hands: { label: string; lm: number[] }[] }[]) : null;
  let busy = false;
  let paused = false;
  let stopped = false;

  worker.onmessage = (e) => {
    if (e.data.type !== 'result') return;
    busy = false;
    const hands = e.data.hands as HandFrame[];
    // Diagnostics for ?debug: tracker speed and how often a hand is actually found.
    stats.frames++;
    if (hands.length) stats.found++;
    if (e.data.t - stats.since > 1000) {
      const s = video.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks()[0]?.getSettings() : undefined;
      tracker.text = `tracker ${delegate} ${Math.round((stats.frames * 1000) / (e.data.t - stats.since))} fps · hand found ${Math.round((stats.found / Math.max(1, stats.frames)) * 100)}% · camera ${s?.width}×${s?.height} @${Math.round(s?.frameRate ?? 0)}`;
      stats.frames = stats.found = 0;
      stats.since = e.data.t;
    }
    if (rec && rec.length < 6000) rec.push({ t: Math.round(e.data.t), hands: hands.map((h) => ({ label: h.label, lm: Array.from(h.landmarks, (v) => Math.round(v * 1e4) / 1e4) })) });
    o.onCursors(gestures.update(hands, e.data.t));
    drawSkeleton(g, sk.width, sk.height, hands);
    const d = hands[0] && handDistance(hands[0].landmarks, aspect);
    if (d && e.data.t - lastCoach > 4000) {
      lastCoach = e.data.t;
      o.onDistance(d);
    }
  };

  // Backpressure: one frame in flight at a time, so a slow machine drops frames instead of lagging.
  const pump = () => {
    if (stopped) return;
    if (!busy && !paused && video.readyState >= 2) {
      busy = true;
      createImageBitmap(video)
        .then((bitmap) => worker.postMessage({ type: 'frame', bitmap, t: performance.now() }, [bitmap]))
        .catch(() => (busy = false));
    }
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(pump);
    else requestAnimationFrame(pump);
  };
  pump();

  const release = () => {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  return {
    recording: () => (rec ? JSON.stringify({ video: [video.videoWidth, video.videoHeight], frames: rec }) : null),
    stop() {
      stopped = true;
      release();
      worker.terminate();
      video.classList.remove('on');
      sk.classList.remove('on');
      o.onCursors([]);
    },
    // Hidden tab: the camera is really turned off (light goes out), not just ignored.
    pause() {
      paused = true;
      release();
      g.clearRect(0, 0, sk.width, sk.height);
      o.onCursors([]);
    },
    async resume() {
      if (stopped || !paused) return;
      stream = await openCamera();
      video.srcObject = stream;
      await video.play();
      paused = false;
      busy = false;
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(pump);
    },
  };
}

const BONES = [0, 1, 1, 2, 2, 3, 3, 4, 0, 5, 5, 6, 6, 7, 7, 8, 5, 9, 9, 10, 10, 11, 11, 12, 9, 13, 13, 14, 14, 15, 15, 16, 13, 17, 17, 18, 18, 19, 19, 20, 0, 17];

function drawSkeleton(g: CanvasRenderingContext2D, w: number, h: number, hands: HandFrame[]) {
  g.clearRect(0, 0, w, h);
  g.lineWidth = 2;
  g.strokeStyle = '#3fe8ff';
  g.fillStyle = '#ffa63d';
  for (const { landmarks: L } of hands) {
    g.beginPath();
    for (let i = 0; i < BONES.length; i += 2) {
      g.moveTo(L[BONES[i] * 3] * w, L[BONES[i] * 3 + 1] * h);
      g.lineTo(L[BONES[i + 1] * 3] * w, L[BONES[i + 1] * 3 + 1] * h);
    }
    g.stroke();
    for (const tip of [4, 8]) g.fillRect(L[tip * 3] * w - 3, L[tip * 3 + 1] * h - 3, 6, 6);
  }
}
