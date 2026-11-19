import type { Cursor } from '../ui';
import { Gestures, handDistance, type HandFrame } from './gestures';
import type { Intents } from './pointer';

/** Live tracker diagnostics: `fps` is shown in the controls panel, `text` with ?debug. */
export const tracker = { text: '', fps: 0 };

export interface HandsSession {
  /** With ?gravar: the landmark numbers seen so far as JSON (no images), or null. */
  recording(): string | null;
  stop(): void;
  pause(): void;
  resume(): Promise<void>;
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
  ['/mediapipe/vision_wasm_internal.wasm', 14_665_716],
];
// One hand, and slow to give up on it (same settings in hands.worker.ts).
const TRACKER = { numHands: 1, minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3 } as const;

type OnHands = (hands: HandFrame[], t: number) => void;
/** Something that turns video frames into hands. `send` returns false when it is still busy. */
interface Detector {
  kind: string;
  send(video: HTMLVideoElement, t: number): boolean;
  close(): void;
}

/**
 * The fast path, as in Google's own demo: the tracker on the page's thread with the GPU,
 * reading the <video> directly (no frame copies). Measured ~16 ms/frame vs ~28 ms in a worker.
 */
async function pageDetector(model: ArrayBuffer, onHands: OnHands): Promise<Detector> {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(`${location.origin}/mediapipe`);
  const lm = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate: 'GPU' },
    runningMode: 'VIDEO',
    ...TRACKER,
  });
  return {
    kind: 'GPU',
    send(video, t) {
      const r = lm.detectForVideo(video, t);
      const hands = r.landmarks.map((points, i) => {
        const l = new Float32Array(63);
        points.forEach((p, j) => l.set([p.x, p.y, p.z], j * 3));
        return { label: r.handedness[i]?.[0]?.categoryName ?? String(i), landmarks: l };
      });
      onHands(hands, t);
      return true;
    },
    close: () => lm.close(),
  };
}

/** Fallback when the GPU path can't start: the tracker in a worker (GPU there if allowed, else CPU). */
async function workerDetector(model: ArrayBuffer, onHands: OnHands): Promise<Detector> {
  const worker = new Worker(new URL('./hands.worker.ts', import.meta.url), { type: 'module' });
  let kind = 'worker';
  try {
    await timeout(
      new Promise<void>((resolve, reject) => {
        worker.onmessage = (e) => {
          if (e.data.type !== 'ready') return reject(new Error(e.data.message));
          kind = `worker ${e.data.delegate}`;
          resolve();
        };
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage({ type: 'init', model }, [model]);
      }),
      MODEL_TIMEOUT,
      'hand tracker',
    );
  } catch (e) {
    worker.terminate();
    throw e;
  }
  let busy = false;
  worker.onmessage = (e) => {
    if (e.data.type !== 'result') return;
    busy = false;
    onHands(e.data.hands as HandFrame[], e.data.t);
  };
  return {
    kind,
    send(video, t) {
      if (busy) return false;
      busy = true;
      createImageBitmap(video, { resizeWidth: 640, resizeHeight: Math.round((640 * video.videoHeight) / Math.max(1, video.videoWidth)) })
        .then((bitmap) => worker.postMessage({ type: 'frame', bitmap, t }, [bitmap]))
        .catch(() => (busy = false));
      return true;
    },
    close: () => worker.terminate(),
  };
}

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

/** Downloads the model (kept) and the WASM (warms the HTTP cache for the tracker), with progress. */
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
        if (i === 0) chunks.push(value); // only the model is kept; the WASM is read just to warm the cache
        done[i] += value.byteLength;
        report();
      }
      return i === 0 ? new Blob(chunks as BlobPart[]).arrayBuffer() : null;
    }),
  );
  return bodies[0]!;
}

export async function startHands(o: Options): Promise<HandsSession> {
  let stream = await openCamera();
  let detector: Detector;
  // Results arrive here from either detector; set below once the session is wired.
  let handle: OnHands = () => {};
  const onHands: OnHands = (h, t) => handle(h, t);
  try {
    const model = await timeout(fetchAssets(o.onProgress), MODEL_TIMEOUT, 'hand model');
    detector = await timeout(pageDetector(model.slice(0), onHands), MODEL_TIMEOUT, 'hand tracker').catch((e) => {
      console.warn('GPU hand tracker unavailable, using the worker', e);
      return workerDetector(model, onHands);
    });
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
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
  let paused = false;
  let stopped = false;

  handle = (hands, t) => {
    // Diagnostics: tracker speed and how often a hand is actually found.
    stats.frames++;
    if (hands.length) stats.found++;
    if (t - stats.since > 1000) {
      const s = video.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks()[0]?.getSettings() : undefined;
      tracker.fps = Math.round((stats.frames * 1000) / (t - stats.since));
      tracker.text = `tracker ${detector.kind} ${tracker.fps} fps · hand found ${Math.round((stats.found / Math.max(1, stats.frames)) * 100)}% · camera ${s?.width}×${s?.height} @${Math.round(s?.frameRate ?? 0)}`;
      stats.frames = stats.found = 0;
      stats.since = t;
    }
    if (rec && rec.length < 6000) rec.push({ t: Math.round(t), hands: hands.map((h) => ({ label: h.label, lm: Array.from(h.landmarks, (v) => Math.round(v * 1e4) / 1e4) })) });
    o.onCursors(gestures.update(hands, t));
    drawSkeleton(g, sk.width, sk.height, hands);
    const d = hands[0] && handDistance(hands[0].landmarks, aspect);
    if (d && t - lastCoach > 4000) {
      lastCoach = t;
      o.onDistance(d);
    }
  };

  // Every new camera frame goes to the tracker (a busy worker just skips frames instead of lagging).
  const pump = () => {
    if (stopped) return;
    if (!paused && video.readyState >= 2) detector.send(video, performance.now());
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
      detector.close();
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
      const fresh = await openCamera();
      // Turned off (or hidden again) while the camera was reopening: don't leave it on.
      if (stopped || document.hidden) {
        fresh.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = fresh;
      video.srcObject = stream;
      await video.play();
      paused = false;
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
