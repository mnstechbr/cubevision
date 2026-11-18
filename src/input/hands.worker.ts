// Hand tracking off the main thread. Frames arrive as ImageBitmaps and never leave this device.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const post = (msg: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(msg);
let landmarker: HandLandmarker | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      // `true` = ES-module build of the WASM loader, the only kind a module worker can load.
      const fileset = await FilesetResolver.forVisionTasks(`${self.location.origin}/mediapipe`, true);
      const model = new Uint8Array(msg.model as ArrayBuffer);
      const make = (delegate: 'GPU' | 'CPU') =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: model, delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      landmarker = await make('GPU').catch(() => make('CPU'));
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'error', message: String(err) });
    }
    return;
  }
  if (msg.type === 'frame') {
    const bitmap = msg.bitmap as ImageBitmap;
    if (!landmarker) {
      bitmap.close();
      return;
    }
    const r = landmarker.detectForVideo(bitmap, msg.t);
    bitmap.close();
    const hands = r.landmarks.map((points, i) => {
      const lm = new Float32Array(63);
      points.forEach((p, j) => lm.set([p.x, p.y, p.z], j * 3));
      return { label: r.handedness[i]?.[0]?.categoryName ?? String(i), landmarks: lm };
    });
    post({ type: 'result', hands, t: msg.t });
  }
};
