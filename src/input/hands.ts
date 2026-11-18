import type { Cursor } from '../ui';
import { Gestures, type HandFrame } from './gestures';
import type { Intents } from './pointer';

export interface HandsSession {
  stop(): void;
  pause(): void;
  resume(): void;
}

interface Options {
  video: HTMLVideoElement;
  intents: Intents;
  armed: () => boolean;
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
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } },
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
  const worker = new Worker(new URL('./hands.worker.ts', import.meta.url), { type: 'module' });
  try {
    const model = await timeout(fetchAssets(o.onProgress), MODEL_TIMEOUT, 'hand model');
    await timeout(
      new Promise<void>((resolve, reject) => {
        worker.onmessage = (e) => (e.data.type === 'ready' ? resolve() : reject(new Error(e.data.message)));
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

  const gestures = new Gestures(o.intents, o.armed);
  let busy = false;
  let paused = false;
  let stopped = false;

  worker.onmessage = (e) => {
    if (e.data.type !== 'result') return;
    busy = false;
    const hands = e.data.hands as HandFrame[];
    o.onCursors(gestures.update(hands, e.data.t));
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
    stop() {
      stopped = true;
      release();
      worker.terminate();
      video.classList.remove('on');
      o.onCursors([]);
    },
    // Hidden tab: the camera is really turned off (light goes out), not just ignored.
    pause() {
      paused = true;
      release();
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
